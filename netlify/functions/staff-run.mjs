/* POST /api/staff-run — 워커 기동 트리거.
   넷리파이 일반 함수는 10초 제한이라 여기서 직접 돌리지 않고, 15분까지 도는
   백그라운드 함수(staff-run-background)에 넘기고 바로 202를 돌려준다.
   프론트(js/staff.js)는 업무를 접수한 직후와 대기 건이 보일 때 이 경로를 친다. */
const BG = '/.netlify/functions/staff-run-background';

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  try {
    /* 백그라운드 함수는 즉시 202를 돌려주므로 await해도 지연이 거의 없다 */
    await fetch(base + BG, { method: 'POST' });
  } catch (err) {
    console.error('[joker staff-run] trigger', err);
  }
  return new Response(JSON.stringify({ ok: true, queued: true }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/staff-run' };
