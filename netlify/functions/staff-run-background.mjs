/* AI 직원 백그라운드 워커 — 파일명이 -background로 끝나면 넷리파이가 호출을
   즉시 202로 끊고 최대 15분까지 실행시켜 준다(일반 함수는 10초 제한이라
   LLM 작업이 끝나기 전에 잘린다). 실제 로직은 api/staff-run.js에 있다.

   호출: POST /.netlify/functions/staff-run-background
   (프론트·예약 함수는 /api/staff-run 을 통해 부른다 — staff-run.mjs 참고) */
import { runPending } from '../../api/staff-run.js';

export default async () => {
  try {
    const out = await runPending();
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[joker staff-run-background]', err);
    return new Response('error', { status: 200 });
  }
};
