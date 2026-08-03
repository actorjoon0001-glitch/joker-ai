/* /api/watch — 방 감시 카메라의 판별기.

   방에 놓아둔 폰이 watch.html을 띄워두고, 브라우저에서 움직임이 잡힌 순간에만
   사진 1장을 여기로 보낸다. 여기서 등록해 둔 참고 사진과 대조해 사람인지,
   상준님인지, 모르는 사람인지 판단하고 필요하면 문자를 보낸다.

   - 움직임 감지 자체는 브라우저에서 공짜로 하고 여기는 호출되지 않는다.
   - 판별은 값싼 모델(JOKER_WATCH_MODEL, 기본 Haiku)로 한다.
   - 모르는 사람일 때만 문자를 보내고, 쿨다운·하루 한도로 폭탄을 막는다.
   - 사진은 침입 감지 건만 남기고 나머지는 저장하지 않는다.
   - JOKER_WATCH=off로 끌 수 있다.

   GET                                   → { faces, events, sms, enabled }
   POST {op:'check', image}              → { verdict, detail, sms }
   POST {op:'face', data, media_type}    → 참고 사진 등록 (최대 3장)
   POST {op:'face_delete', id}           → 참고 사진 삭제 */
import Anthropic from '@anthropic-ai/sdk';
import { sb, isDbNotReady } from './_lib/db.js';
import { solapiEnv, normalizeNumber, sendSms } from './_lib/solapi.js';

const MODEL = process.env.JOKER_WATCH_MODEL || 'claude-haiku-4-5-20251001';
const MAX_FACES = 3;
const SMS_COOLDOWN_MS = 10 * 60 * 1000; /* 같은 침입자로 계속 울리지 않게 */
const SMS_DAILY_CAP = 20;
const CHECK_HOURLY_CAP = 150; /* 폰이 오작동해도 요금이 터지지 않게 */

const PROMPT =
`너는 방에 설치된 감시 카메라의 판별기다. 마지막 사진은 방금 찍힌 장면이고, 그 앞에 사람 참고 사진이 있을 수 있다.

아래 JSON만 출력해라. 설명·마크다운·코드블록 금지.
{"person":true|false,"who":"owner"|"stranger"|"unsure","detail":"한국어 한 문장"}

판단 규칙:
- person: 장면에 사람이 보이면 true. 커튼·빛·그림자·반려동물·화면 속 인물은 false.
- who: 참고 사진의 인물과 같은 사람으로 보이면 owner, 분명히 다른 사람이면 stranger, 얼굴이 안 보이거나 흐려서 확신할 수 없으면 unsure.
- 참고 사진이 없으면 who는 항상 unsure.
- detail: 무엇이 보이는지 짧게. 예) "책상 앞에 앉은 남성 1명", "빈 방, 커튼만 흔들림".
- 애매하면 stranger로 단정하지 말고 unsure를 써라.`;

function enabled() {
  return String(process.env.JOKER_WATCH || '').toLowerCase() !== 'off';
}

/* 알림 받을 번호 — 리마인더 문자와 같은 설정을 쓴다 */
function alertNumber() {
  const env = solapiEnv();
  return normalizeNumber(process.env.JOKER_SMS_TO || env.sender);
}

function cleanImage(img) {
  if (!img || typeof img !== 'object') return null;
  const data = typeof img.data === 'string' ? img.data.replace(/^data:[^,]+,/, '') : '';
  const type = String(img.media_type || 'image/jpeg');
  if (!data || data.length < 100 || data.length > 4_000_000) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return null;
  return { media_type: type, data };
}

/* 모델이 앞뒤에 뭘 붙여도 첫 JSON 덩어리만 뽑아 쓴다 */
function parseVerdict(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const who = ['owner', 'stranger', 'unsure'].includes(j.who) ? j.who : 'unsure';
    return {
      person: j.person === true,
      who,
      detail: String(j.detail || '').slice(0, 200),
    };
  } catch {
    return null;
  }
}

async function recentEvents(sinceMs, filter = '') {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const r = await sb(
    `joker_watch_events?select=id,verdict,detail,sms_sent,created_at&created_at=gte.${encodeURIComponent(since)}` +
    filter + '&order=created_at.desc&limit=200'
  );
  if (!r.ok) return { ok: false, status: r.status, rows: [] };
  return { ok: true, status: 200, rows: await r.json().catch(() => []) };
}

async function logEvent(row) {
  try {
    await sb('joker_watch_events', { method: 'POST', body: JSON.stringify(row) });
  } catch {}
}

async function saveUsage(usage) {
  if (!usage) return;
  try {
    await sb('joker_usage', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'watch',
        model: MODEL,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        searches: 0,
      }),
    });
  } catch {}
}

/* 모르는 사람 → 문자. 쿨다운과 하루 한도를 먼저 확인한다. */
async function alertStranger(detail) {
  const env = solapiEnv();
  const to = alertNumber();
  if (!env.configured || !to) return { status: 'not_configured' };

  const day = await recentEvents(24 * 3600 * 1000, '&sms_sent=eq.true');
  if (day.ok) {
    if (day.rows.length >= SMS_DAILY_CAP) return { status: 'daily_cap' };
    const last = day.rows[0];
    if (last && Date.now() - new Date(last.created_at).getTime() < SMS_COOLDOWN_MS) {
      return { status: 'cooldown' };
    }
  }

  const when = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16); /* KST */
  const text = `[조커] ${when} 방에서 모르는 사람이 감지됐습니다.` + (detail ? `\n${detail}` : '');
  const sent = await sendSms(env, to, text.slice(0, 200));
  return sent.ok ? { status: 'sent' } : { status: 'failed', detail: sent.detail };
}

async function handleCheck(res, body) {
  const image = cleanImage(body.image);
  if (!image) { res.status(400).json({ error: 'invalid_image' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(501).json({ error: 'no_api_key' }); return; }

  const hour = await recentEvents(3600 * 1000);
  if (isDbNotReady(hour.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
  if (hour.ok && hour.rows.length >= CHECK_HOURLY_CAP) {
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const fr = await sb(`joker_watch_faces?select=id,label,media_type,data&order=id.asc&limit=${MAX_FACES}`);
  if (isDbNotReady(fr.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
  const faces = fr.ok ? await fr.json().catch(() => []) : [];

  const content = [];
  for (const f of faces) {
    content.push({ type: 'text', text: `참고 사진 — ${f.label || '상준님'}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
  }
  content.push({ type: 'text', text: faces.length ? '방금 찍힌 장면:' : '참고 사진 없음. 방금 찍힌 장면:' });
  content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } });

  let verdict = null;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: PROMPT,
      messages: [{ role: 'user', content }],
    });
    await saveUsage(msg.usage);
    verdict = parseVerdict((msg.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
  } catch (err) {
    console.error('[joker watch]', err);
    res.status(502).json({ error: 'model_error' });
    return;
  }
  if (!verdict) { res.status(502).json({ error: 'bad_verdict' }); return; }

  /* 참고 사진이 없으면 사람을 봐도 누군지 단정할 수 없다 */
  const who = faces.length ? verdict.who : 'unsure';
  const kind = !verdict.person ? 'none' : who === 'owner' ? 'owner' : who === 'stranger' ? 'stranger' : 'unsure';

  let sms = { status: 'skipped' };
  if (kind === 'stranger') sms = await alertStranger(verdict.detail);

  await logEvent({
    verdict: kind,
    detail: verdict.detail || null,
    /* 침입 의심 건만 사진을 남긴다 */
    image: kind === 'stranger' ? image.data : null,
    sms_sent: sms.status === 'sent',
  });

  res.status(200).json({ verdict: kind, detail: verdict.detail, sms: sms.status, faces: faces.length });
}

export default async function handler(req, res) {
  try {
    if (!enabled()) { res.status(503).json({ error: 'disabled' }); return; }

    if (req.method === 'GET') {
      const fr = await sb(`joker_watch_faces?select=id,label,created_at&order=id.asc&limit=${MAX_FACES}`);
      if (isDbNotReady(fr.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!fr.ok) { res.status(502).json({ error: 'db_error' }); return; }
      const ev = await recentEvents(24 * 3600 * 1000, '&verdict=neq.none');
      res.status(200).json({
        faces: await fr.json().catch(() => []),
        events: ev.rows.slice(0, 30),
        sms: Boolean(solapiEnv().configured && alertNumber()),
      });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.op === 'check') { await handleCheck(res, b); return; }

      if (b.op === 'face') {
        const image = cleanImage(b);
        if (!image) { res.status(400).json({ error: 'invalid_image' }); return; }
        const cr = await sb('joker_watch_faces?select=id');
        if (isDbNotReady(cr.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        const have = cr.ok ? (await cr.json().catch(() => [])).length : 0;
        if (have >= MAX_FACES) { res.status(400).json({ error: 'too_many_faces' }); return; }
        const r = await sb('joker_watch_faces', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            label: String(b.label || '상준님').slice(0, 40),
            media_type: image.media_type,
            data: image.data,
          }),
        });
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        const rows = await r.json().catch(() => []);
        res.status(200).json({ ok: true, face: rows[0] ? { id: rows[0].id, label: rows[0].label } : null });
        return;
      }

      if (b.op === 'face_delete') {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
        const r = await sb(`joker_watch_faces?id=eq.${id}`, { method: 'DELETE' });
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'bad_op' });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker watch]', err);
    res.status(500).json({ error: 'server_error' });
  }
}

export const config = { maxDuration: 60 };
