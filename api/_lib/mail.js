/* 메일 발송 공용 클라이언트 — api/mail.js(사용자가 카드에서 확인한 발송)에서 쓴다.
   HTTP API 방식 두 곳을 지원하고, 등록된 환경변수로 자동 선택한다.
     · RESEND_API_KEY   — 도메인을 인증해 두고 그 도메인 주소로 보낼 때
     · SENDGRID_API_KEY — 도메인 없이 지메일 주소 하나만 인증해 쓸 때
   MAIL_FROM(발신 주소, "조커 <me@example.com>" 형식도 가능)은 필수. */

/* "이름 <a@b.com>" 또는 "a@b.com" → { name, email } */
export function parseAddress(v) {
  const s = String(v || '').trim();
  const m = s.match(/^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^["']|["']$/g, '').trim(), email: m[2] };
  return { name: '', email: s };
}

export function isEmail(v) {
  const s = String(v || '').trim();
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s) ? s : null;
}

export function mailEnv() {
  const resend = process.env.RESEND_API_KEY;
  const sendgrid = process.env.SENDGRID_API_KEY;
  const provider = resend ? 'resend' : sendgrid ? 'sendgrid' : null;
  const from = parseAddress(process.env.MAIL_FROM || '');
  const replyTo = isEmail(process.env.MAIL_REPLY_TO || '');
  return {
    provider,
    key: resend || sendgrid || '',
    from,
    replyTo,
    resendBase: process.env.RESEND_BASE_URL || 'https://api.resend.com',
    sendgridBase: process.env.SENDGRID_BASE_URL || 'https://api.sendgrid.com',
    configured: Boolean(provider && isEmail(from.email)),
  };
}

/* 한 통을 한 사람에게. → { ok:true } | { ok:false, status, detail, permanent } */
export async function sendMail(env, to, subject, text) {
  const url = env.provider === 'resend'
    ? env.resendBase + '/emails'
    : env.sendgridBase + '/v3/mail/send';
  const body = env.provider === 'resend'
    ? {
        from: env.from.name ? `${env.from.name} <${env.from.email}>` : env.from.email,
        to: [to],
        subject,
        text,
        ...(env.replyTo ? { reply_to: env.replyTo } : {}),
      }
    : {
        personalizations: [{ to: [{ email: to }] }],
        from: env.from.name ? { email: env.from.email, name: env.from.name } : { email: env.from.email },
        subject,
        content: [{ type: 'text/plain', value: text }],
        ...(env.replyTo ? { reply_to: { email: env.replyTo } } : {}),
      };

  try {
    const up = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!up.ok) {
      /* 발신 주소 미인증·키 오류 등 사유를 카드에 그대로 보여줄 수 있게 뽑아낸다 */
      const raw = await up.text().catch(() => '');
      let detail = raw.slice(0, 200);
      try {
        const j = JSON.parse(raw);
        detail = String(
          j.message || j.error || (j.errors && j.errors[0] && j.errors[0].message) || up.status
        ).slice(0, 200);
      } catch {}
      console.error('[joker mail]', env.provider, up.status, detail);
      return { ok: false, status: up.status, detail, permanent: up.status >= 400 && up.status < 500 };
    }
    return { ok: true };
  } catch (err) {
    console.error('[joker mail]', err);
    return { ok: false, status: 0, detail: 'network_error', permanent: false };
  }
}
