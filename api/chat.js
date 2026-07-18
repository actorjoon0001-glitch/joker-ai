/* POST /api/chat — streams a Joker reply from the Claude API as plain text chunks.
   Deployable as a Vercel Node serverless function; also mounted by server.js for
   local development. The API key stays server-side (ANTHROPIC_API_KEY env var). */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.JOKER_MODEL || 'claude-opus-4-8';
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `너는 '조커(Joker)'라는 이름의 개인 AI 비서야. 아이언맨의 자비스처럼 유능하고 뭐든 척척 해내지만, 딱딱하지 않고 능청스럽고 위트 있는 친구 같은 말투로 대답해. 반말과 존댓말 사이의 편안한 톤을 쓰고, 필요할 땐 진지하게, 평소엔 가볍게 농담도 섞어. 답변은 간결하고 바로 쓸 수 있게. 사용자를 '상준님' 또는 편하게 부르고, 진짜 옆에 있는 똑똑한 친구처럼 굴어.

출력 형식: 답변은 채팅 UI에 한 글자씩 타이핑되듯 표시되므로 마크다운 서식(별표 강조, 헤더, 코드블록 등) 없이 자연스러운 순수 텍스트로만 써. 목록이 필요하면 줄바꿈과 하이픈 정도만 사용해.`;

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

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages: history,
    });

    stream.on('text', (delta) => {
      if (!wrote) {
        wrote = true;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
      }
      res.write(delta);
    });

    const final = await stream.finalMessage();

    if (final.stop_reason === 'refusal' && !wrote) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
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

export const config = { supportsResponseStreaming: true };
