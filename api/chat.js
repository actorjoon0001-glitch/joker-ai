/* POST /api/chat — streams a Joker reply from the Claude API as plain text chunks.
   Deployable as a Vercel Node serverless function; also mounted by server.js for
   local development. The API key stays server-side (ANTHROPIC_API_KEY env var). */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.JOKER_MODEL || 'claude-opus-4-8';
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `너는 '조커(Joker)'라는 이름의 개인 AI 비서야. 아이언맨의 자비스처럼 유능하고 뭐든 척척 해내지만, 딱딱하지 않고 능청스럽고 위트 있는 친구 같은 말투로 대답해. 반말과 존댓말 사이의 편안한 톤을 쓰고, 필요할 땐 진지하게, 평소엔 가볍게 농담도 섞어. 답변은 간결하고 바로 쓸 수 있게. 사용자를 '상준님' 또는 편하게 부르고, 진짜 옆에 있는 똑똑한 친구처럼 굴어.

상준님의 회사에는 다음 부서가 있어: 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀. 대화 맥락상 해당 부서의 업무를 알고 있는 것처럼 자연스럽게 응대해.

내부 라우팅 규칙(반드시 지켜): 모든 답변의 맨 처음에 [부서:팀명] 태그를 붙여. 팀명은 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀, 일반 중 정확히 하나야. 지금 대화 주제가 특정 부서 업무와 관련되면 그 팀을, 일상 대화나 어느 부서에도 속하지 않으면 일반을 써. 이 태그는 시스템이 제거해서 사용자에게는 보이지 않으니 태그 뒤에 바로 답변 본문을 이어서 써.

출력 형식: 답변은 채팅 UI에 한 글자씩 타이핑되듯 표시되므로 마크다운 서식(별표 강조, 헤더, 코드블록 등) 없이 자연스러운 순수 텍스트로만 써. 목록이 필요하면 줄바꿈과 하이픈 정도만 사용해.`;

/* Korean team name (as the model tags it) → dept key used by the frontend */
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

/* Keep only well-formed {role, content} string turns, ensure the sequence starts
   with a user turn, and cap the length. */
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const history = sanitizeHistory(req.body && req.body.messages);
  if (!history) {
    res.status(400).json({ error: 'invalid_messages' });
    return;
  }

  const client = new Anthropic();
  let wrote = false;

  const ensureHeaders = () => {
    if (wrote) return;
    wrote = true;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
  };

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages: history,
    });

    /* The model prefixes its reply with a [부서:팀명] tag (see SYSTEM_PROMPT).
       Buffer until the tag is parseable, strip it, and forward the department to
       the client as a "\u0000dept:<key>\u0000" control header before the text. */
    let tagBuf = '';
    let tagDone = false;
    let emitted = 0;

    const forward = (text) => {
      if (!text) return;
      ensureHeaders();
      emitted += text.length;
      res.write(text);
    };

    stream.on('text', (delta) => {
      if (tagDone) { forward(delta); return; }
      tagBuf += delta;
      const m = tagBuf.match(/^\s*\[부서\s*:\s*([^\]]{1,20})\]\s*/);
      if (m) {
        tagDone = true;
        const key = DEPT_KEYS[m[1].trim()] || 'general';
        ensureHeaders();
        res.write('\u0000dept:' + key + '\u0000');
        forward(tagBuf.slice(m[0].length));
        tagBuf = '';
      } else if (!/^\s*(\[[^\]]*)?$/.test(tagBuf) || tagBuf.length > 60) {
        /* not a plausible unfinished tag — flush as-is */
        tagDone = true;
        forward(tagBuf);
        tagBuf = '';
      }
    });

    const final = await stream.finalMessage();
    if (!tagDone && tagBuf) forward(tagBuf); /* short reply that never resolved the tag */

    if (final.stop_reason === 'refusal' && emitted === 0) {
      ensureHeaders();
      res.write(OVERLOAD_LINE);
    }
    res.end();
  } catch (err) {
    console.error('[joker api]', err);
    if (wrote) {
      /* mid-stream failure: the client keeps whatever text already arrived */
      res.end();
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'rate_limited' });
    } else if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: 'server_not_configured' });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: 'upstream_error' });
    } else {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

export const config = { supportsResponseStreaming: true, maxDuration: 60 };
