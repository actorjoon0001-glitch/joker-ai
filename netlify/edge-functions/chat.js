/* Netlify Edge Function for /api/chat — streams Claude replies without the 10s
   regular-function timeout. Fully self-contained (no imports) because the edge
   bundler proved unreliable with module imports.
   NOTE: persona/prompt logic mirrors api/_lib/core.js — keep the two in sync. */

const MODEL_DEFAULT = 'claude-opus-4-8';
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `너는 '조커(Joker)'라는 이름의 개인 AI 비서야. 아이언맨의 자비스처럼 유능하고 뭐든 척척 해내지만, 딱딱하지 않고 능청스럽고 위트 있는 친구 같은 말투로 대답해. 반말과 존댓말 사이의 편안한 톤을 쓰고, 필요할 땐 진지하게, 평소엔 가볍게 농담도 섞어. 답변은 간결하고 바로 쓸 수 있게. 사용자를 '상준님' 또는 편하게 부르고, 진짜 옆에 있는 똑똑한 친구처럼 굴어.

상준님의 회사에는 다음 부서가 있어: 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀. 대화 맥락상 해당 부서의 업무를 알고 있는 것처럼 자연스럽게 응대해.

내부 라우팅 규칙(반드시 지켜): 모든 답변의 맨 처음에 [부서:팀명] 태그를 붙여. 팀명은 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀, 일반 중 정확히 하나야. 지금 대화 주제가 특정 부서 업무와 관련되면 그 팀을, 일상 대화나 어느 부서에도 속하지 않으면 일반을 써. 이 태그는 시스템이 제거해서 사용자에게는 보이지 않으니 태그 뒤에 바로 답변 본문을 이어서 써.

출력 형식: 답변은 채팅 UI에 한 글자씩 타이핑되듯 표시되므로 마크다운 서식(별표 강조, 헤더, 코드블록 등) 없이 자연스러운 순수 텍스트로만 써. 목록이 필요하면 줄바꿈과 하이픈 정도만 사용해.`;

const DEPT_KEYS = {
  '마케팅팀': 'marketing', '마케팅': 'marketing',
  '설계팀': 'design', '설계': 'design',
  '시공팀': 'construction', '시공': 'construction',
  '정산팀': 'finance', '정산': 'finance',
  '법무팀': 'legal', '법무': 'legal',
  '영업팀': 'sales', '영업': 'sales',
  '전략기획팀': 'strategy', '전략기획': 'strategy', '전략': 'strategy',
  '일반': 'general',
};

const OVERLOAD_LINE =
  '으음… 그 질문은 제 회로가 정중히 사양하겠답니다. 다른 주제라면 뭐든 환영입니다.';

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return null;
  const clean = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = m.content.slice(0, 8000).trim();
    if (!content) continue;
    clean.push({ role: m.role, content });
  }
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return null;
  return clean.slice(-MAX_HISTORY);
}

function buildKnowledgeBlock(k) {
  if (!k || typeof k !== 'object') return null;
  const clip = (s) => (typeof s === 'string' ? s.trim().slice(0, 2000) : '');
  const NAMES = {
    marketing: '마케팅팀', design: '설계팀', construction: '시공팀',
    finance: '정산팀', legal: '법무팀', sales: '영업팀', strategy: '전략기획팀',
  };
  const lines = [];
  const company = clip(k.company);
  if (company) lines.push('회사 공통: ' + company);
  for (const [key, name] of Object.entries(NAMES)) {
    const v = clip(k.depts && k.depts[key]);
    if (v) lines.push(name + ': ' + v);
  }
  if (!lines.length) return null;
  return (
    '\n\n[회사 메모리 — 상준님이 직접 등록해 둔 정보]\n' +
    lines.join('\n').slice(0, 12000) +
    '\n이 정보를 이미 알고 있는 비서처럼 답변에 자연스럽게 활용해.'
  );
}

function buildSkillBlock(skills) {
  if (!Array.isArray(skills) || !skills.length) return null;
  const out = [];
  for (const s of skills.slice(0, 3)) {
    if (!s || typeof s.name !== 'string' || typeof s.body !== 'string') continue;
    const name = s.name.trim().slice(0, 40);
    const body = s.body.trim().slice(0, 4000);
    if (!name || !body) continue;
    out.push('◆ ' + name + '\n' + body);
  }
  if (!out.length) return null;
  return (
    '\n\n[활성 스킬 — 이번 요청에 적용할 업무 지침]\n' +
    out.join('\n\n') +
    '\n위 지침은 상준님이 직접 등록한 업무 방법이야. 이번 답변에서 톤·양식·순서를 이 지침대로 처리해.'
  );
}

function createDeptTagFilter(writeText, writeHeader) {
  let buf = '';
  let done = false;
  return {
    feed(delta) {
      if (done) { writeText(delta); return; }
      buf += delta;
      const m = buf.match(/^\s*\[부서\s*:\s*([^\]]{1,20})\]\s*/);
      if (m) {
        done = true;
        writeHeader('\u0000dept:' + (DEPT_KEYS[m[1].trim()] || 'general') + '\u0000');
        const rest = buf.slice(m[0].length);
        if (rest) writeText(rest);
        buf = '';
      } else if (!/^\s*(\[[^\]]*)?$/.test(buf) || buf.length > 60) {
        done = true;
        if (buf) writeText(buf);
        buf = '';
      }
    },
    flush() {
      if (!done && buf) { done = true; writeText(buf); buf = ''; }
    },
  };
}

/* Env values pasted into the Netlify UI can carry invisible unicode (zero-width
   spaces, NBSP…) which makes Deno's Request constructor reject the header as a
   non-ByteString. Our env values (API key, model id, base URL) are all printable
   ASCII, so strip anything else. */
function cleanEnv(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[^\x20-\x7E]/g, '').trim();
  return s || undefined;
}

function getEnv(k) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
      const v = cleanEnv(Netlify.env.get(k));
      if (v !== undefined) return v;
    }
  } catch (_) {}
  try {
    if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
      const v = cleanEnv(Deno.env.get(k));
      if (v !== undefined) return v;
    }
  } catch (_) {}
  try {
    if (typeof process !== 'undefined' && process.env) return cleanEnv(process.env[k]);
  } catch (_) {}
  return undefined;
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(request) {
  let debug = false;
  try {
    debug = new URL(request.url).searchParams.get('debug') === '1';
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    let body = {};
    try { body = await request.json(); } catch (_) {}
    const history = sanitizeHistory(body.messages);
    if (!history) return json(400, { error: 'invalid_messages' });

    const apiKey = getEnv('ANTHROPIC_API_KEY');
    if (!apiKey) return json(500, { error: 'server_not_configured' });

    const knowledgeBlock = buildKnowledgeBlock(body.knowledge);
    const skillBlock = buildSkillBlock(body.skills);

    const upstream = await fetch((getEnv('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: getEnv('JOKER_MODEL') || MODEL_DEFAULT,
        max_tokens: 2048,
        stream: true,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT + (knowledgeBlock || '') + (skillBlock || ''),
        messages: history,
      }),
    });

    if (!upstream.ok) {
      const status = upstream.status;
      const detail = await upstream.text().catch(() => '');
      console.error('[joker edge] upstream', status, detail);
      if (status === 401 || status === 403) return json(500, { error: 'server_not_configured' });
      if (status === 429) return json(429, { error: 'rate_limited' });
      if (status === 400) return json(500, debug ? { error: 'server_not_configured', detail } : { error: 'server_not_configured' });
      return json(502, { error: 'upstream_error' });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        let emitted = 0;
        const filter = createDeptTagFilter(
          (text) => { emitted += text.length; controller.enqueue(encoder.encode(text)); },
          (header) => controller.enqueue(encoder.encode(header)),
        );

        let sseBuf = '';
        let stopReason = null;
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            const lines = sseBuf.split('\n');
            sseBuf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              let ev;
              try { ev = JSON.parse(line.slice(6)); } catch (_) { continue; }
              if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
                filter.feed(ev.delta.text);
              } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
                stopReason = ev.delta.stop_reason;
              }
            }
          }
          filter.flush();
          if (stopReason === 'refusal' && emitted === 0) {
            controller.enqueue(encoder.encode(OVERLOAD_LINE));
          }
        } catch (err) {
          console.error('[joker edge] stream', err);
        } finally {
          try { controller.close(); } catch (_) {}
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    console.error('[joker edge] fatal', err);
    return json(500, debug
      ? { error: 'internal_error', detail: String(err && (err.stack || err.message || err)) }
      : { error: 'internal_error' });
  }
}

export const config = { path: '/api/chat' };
