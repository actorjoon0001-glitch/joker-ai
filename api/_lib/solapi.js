/* Shared Solapi(솔라피) SMS client — used by api/sms.js (user-confirmed sends)
   and netlify/functions/reminder-sms.mjs (scheduled reminder texts).
   Auth is HMAC-SHA256 over (date + salt) with the API secret. */
import crypto from 'node:crypto';

export function solapiEnv() {
  const key = process.env.SOLAPI_API_KEY;
  const secret = process.env.SOLAPI_API_SECRET;
  const sender = (process.env.SOLAPI_SENDER || '').replace(/[^0-9]/g, '');
  const base = process.env.SOLAPI_BASE_URL || 'https://api.solapi.com';
  return { key, secret, sender, base, configured: Boolean(key && secret && sender) };
}

/* 국내 휴대폰/유선 번호(0으로 시작하는 9~11자리)만 통과시킨다 */
export function normalizeNumber(v) {
  const n = String(v || '').replace(/[^0-9]/g, '');
  return /^0\d{8,10}$/.test(n) ? n : null;
}

/* Sends one message to one recipient.
   → { ok: true } | { ok: false, status, detail, permanent } */
export async function sendSms(env, to, text) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', env.secret).update(date + salt).digest('hex');
  try {
    const up = await fetch(env.base + '/messages/v4/send', {
      method: 'POST',
      headers: {
        Authorization: `HMAC-SHA256 apiKey=${env.key}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { to, from: env.sender, text } }),
    });
    const j = await up.json().catch(() => ({}));
    if (!up.ok) {
      const detail = String(j.errorMessage || j.message || up.status).slice(0, 200);
      console.error('[joker solapi]', up.status, detail);
      /* 4xx는 재시도해도 같은 결과 — 호출자가 재시도를 멈출 수 있게 알려준다 */
      return { ok: false, status: up.status, detail, permanent: up.status >= 400 && up.status < 500 };
    }
    return { ok: true };
  } catch (err) {
    console.error('[joker solapi]', err);
    return { ok: false, status: 0, detail: 'network_error', permanent: false };
  }
}
