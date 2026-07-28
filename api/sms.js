/* POST /api/sms — sends ONE text message via Solapi (솔라피), only called by
   the chat UI after the user pressed 전송 on the confirmation card that a
   [[문자:번호|내용]] tag produced. The chat stream handler never sends
   directly — this endpoint is the single send path, one recipient per call.
   Returns 501 (not_configured) until SOLAPI_API_KEY / SOLAPI_API_SECRET /
   SOLAPI_SENDER(사전 등록된 발신번호) are deployed. */
import { solapiEnv, normalizeNumber, sendSms } from './_lib/solapi.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const env = solapiEnv();
  if (!env.configured) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }

  const b = req.body || {};
  const to = normalizeNumber(b.to);
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 1000) : '';
  if (!to) {
    res.status(400).json({ error: 'invalid_to' });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'invalid_text' });
    return;
  }

  const r = await sendSms(env, to, text);
  if (!r.ok) {
    /* 발신번호 미등록·잔액 부족 등 솔라피 사유를 카드에 보여줄 수 있게 전달 */
    res.status(502).json({ error: 'sms_error', detail: r.detail });
    return;
  }
  res.status(200).json({ ok: true });
}
