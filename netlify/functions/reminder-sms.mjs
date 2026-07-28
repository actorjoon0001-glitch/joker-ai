/* 예약 실행 함수 — 기한이 된 리마인더·일정을 상준님 폰으로 문자 발송한다.
   조커 웹페이지가 열려 있어야만 울리던 알림의 한계를 없애는 게 목적이라
   서버(넷리파이 스케줄러)가 2분마다 돌면서 joker_events를 확인한다.

   보낸 건은 sms_sent=true로 표시해 중복 발송을 막고, 클라이언트 알림용
   notified 플래그는 건드리지 않는다(웹페이지 말풍선은 그대로 동작).
   너무 오래된 건까지 문자가 몰리지 않도록 기한 6시간 이내만 대상으로 한다.

   SOLAPI_* 환경변수가 없으면 아무 것도 하지 않고, JOKER_SMS_REMINDERS=off로
   기능만 끌 수도 있다. 수신번호는 JOKER_SMS_TO, 없으면 발신번호(본인)로 간다. */
import { solapiEnv, normalizeNumber, sendSms } from '../../api/_lib/solapi.js';
import { sb } from '../../api/_lib/db.js';

const WINDOW_MS = 6 * 3600 * 1000; /* 기한 지난 지 6시간까지만 발송 */
const MAX_PER_RUN = 5;             /* 한 번에 몰아 보내지 않도록 */

const KST_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
});
const KST_DAY = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric',
});

/* 이모지는 국내에서 MMS로 전환돼 요금이 올라가므로 순수 텍스트만 쓴다.
   단문(SMS) 요금 구간을 넘지 않도록 제목은 40자에서 자른다. */
export function buildText(ev) {
  const d = new Date(ev.due_at);
  const label = ev.kind === 'event' ? '일정' : '알림';
  const when = ev.end_at
    ? `${KST_DAY.format(d)}~${KST_DAY.format(new Date(ev.end_at))}`
    : KST_TIME.format(d);
  return `[조커 ${label}] ${when} ${String(ev.title || '').slice(0, 40)}`;
}

export default async function handler() {
  const env = solapiEnv();
  if (!env.configured) return new Response('sms_not_configured');
  if (String(process.env.JOKER_SMS_REMINDERS || '').toLowerCase() === 'off') {
    return new Response('disabled');
  }
  const to = normalizeNumber(process.env.JOKER_SMS_TO || env.sender);
  if (!to) return new Response('no_recipient');

  const now = Date.now();
  const since = new Date(now - WINDOW_MS).toISOString();
  const until = new Date(now).toISOString();

  let due = [];
  try {
    const r = await sb(
      'joker_events?select=id,kind,title,due_at,end_at&sms_sent=eq.false' +
      `&due_at=gte.${encodeURIComponent(since)}&due_at=lte.${encodeURIComponent(until)}` +
      `&order=due_at.asc&limit=${MAX_PER_RUN}`
    );
    if (!r.ok) {
      console.error('[joker reminder-sms] db', r.status);
      return new Response('db_error', { status: 200 });
    }
    due = await r.json();
  } catch (err) {
    console.error('[joker reminder-sms] db', err);
    return new Response('db_error', { status: 200 });
  }

  let sent = 0;
  for (const ev of due) {
    const res = await sendSms(env, to, buildText(ev));
    /* 성공했거나 재시도해도 소용없는 실패(4xx)면 더 시도하지 않게 표시한다.
       일시적인 네트워크 오류는 표시하지 않고 다음 실행에서 재시도. */
    if (res.ok || res.permanent) {
      try {
        await sb(`joker_events?id=eq.${ev.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ sms_sent: true }),
        });
      } catch (err) {
        console.error('[joker reminder-sms] mark', err);
      }
    }
    if (res.ok) sent++;
  }
  return new Response('sent:' + sent);
}

/* 넷리파이 예약 실행 (UTC 기준 cron) — 2분마다 확인 */
export const config = { schedule: '*/2 * * * *' };
