/* POST /api/sms — sends ONE text message via Solapi (솔라피), only called by
   the chat UI after the user pressed 전송 on the confirmation card that a
   [[문자:번호|내용]] tag produced. The chat stream handler never sends
   directly — this endpoint is the single send path, one recipient per call.
   Returns 501 (not_configured) until SOLAPI_API_KEY / SOLAPI_API_SECRET /
   SOLAPI_SENDER(사전 등록된 발신번호) are deployed. */
import crypto from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const key = process.env.SOLAPI_API_KEY;
  const secret = process.env.SOLAPI_API_SECRET;
  const sender = (process.env.SOLAPI_SENDER || '').replace(/[^0-9]/g, '');
  if (!key || !secret || !sender) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }

  const b = req.body || {};
  const to = typeof b.to === 'string' ? b.to.replace(/[^0-9]/g, '') : '';
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 1000) : '';
  /* 국내 휴대폰/유선 번호 형태만 허용 (9~11자리, 0으로 시작) */
  if (!/^0\d{8,10}$/.test(to)) {
    res.status(400).json({ error: 'invalid_to' });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'invalid_text' });
    return;
  }

  try {
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const signature = crypto.createHmac('sha256', secret).update(date + salt).digest('hex');
    const base = process.env.SOLAPI_BASE_URL || 'https://api.solapi.com';
    const up = await fetch(base + '/messages/v4/send', {
      method: 'POST',
      headers: {
        Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { to, from: sender, text } }),
    });
    const j = await up.json().catch(() => ({}));
    if (!up.ok) {
      console.error('[joker sms] upstream', up.status, JSON.stringify(j).slice(0, 300));
      /* 발신번호 미등록·잔액 부족 등 솔라피 사유를 카드에 보여줄 수 있게 전달 */
      res.status(502).json({ error: 'sms_error', detail: String(j.errorMessage || j.message || up.status).slice(0, 200) });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[joker sms]', err);
    res.status(502).json({ error: 'sms_error' });
  }
}
