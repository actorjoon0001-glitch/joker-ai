/* POST /api/mail — 메일 한 통을 한 사람에게 보낸다. [[메일:주소|제목|내용]] 태그가
   띄운 확인 카드에서 사용자가 "전송"을 누른 뒤에만 호출된다. 채팅 스트림
   핸들러는 절대 직접 발송하지 않으며, 이 엔드포인트가 유일한 발송 경로다.
   MAIL_FROM + (RESEND_API_KEY | SENDGRID_API_KEY) 미설정 시 501. */
import { mailEnv, isEmail, sendMail } from './_lib/mail.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const env = mailEnv();
  if (!env.configured) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }

  const b = req.body || {};
  const to = isEmail(b.to);
  const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 200) : '';
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 5000) : '';
  if (!to) {
    res.status(400).json({ error: 'invalid_to' });
    return;
  }
  if (!subject || !text) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }

  const r = await sendMail(env, to, subject, text);
  if (!r.ok) {
    res.status(502).json({ error: 'mail_error', detail: r.detail });
    return;
  }
  res.status(200).json({ ok: true });
}
