/* 예약 실행 — 웹페이지를 닫아둬도 배정된 업무가 처리되도록 5분마다 확인한다.
   대기 중인 업무가 있을 때만 백그라운드 워커를 깨우므로 평소에는 Supabase
   조회 한 번으로 끝난다(무료 실행 시간 절약). */
import { sb } from '../../api/_lib/db.js';

const BG = '/.netlify/functions/staff-run-background';

export default async () => {
  if (String(process.env.JOKER_STAFF_WORKER || '').toLowerCase() === 'off') {
    return new Response('disabled');
  }
  try {
    const r = await sb('joker_staff_tasks?select=id&status=eq.pending&limit=1');
    if (!r.ok) return new Response('db_' + r.status);
    const rows = await r.json().catch(() => []);
    if (!rows.length) return new Response('idle');
  } catch (err) {
    console.error('[joker staff-tick] db', err);
    return new Response('db_error');
  }

  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  if (!base) return new Response('no_base');
  try {
    await fetch(base + BG, { method: 'POST' });
  } catch (err) {
    console.error('[joker staff-tick] trigger', err);
  }
  return new Response('woke');
};

export const config = { schedule: '*/5 * * * *' };
