/* POST /api/chat — streams a Joker reply from the Claude API as plain text chunks.
   Deployable as a Vercel Node serverless function; also mounted by server.js for
   local development. On Netlify this path is served by the edge function instead
   (netlify/edge-functions/chat.js) to avoid the 10s function timeout.
   The API key stays server-side (ANTHROPIC_API_KEY env var). */
import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL_DEFAULT, OVERLOAD_LINE, sanitizeHistory, buildSystem, createDeptTagFilter,
  validateImage, toApiMessages,
} from './_lib/core.js';

const MODEL = process.env.JOKER_MODEL || MODEL_DEFAULT;

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
      system: buildSystem(req.body),
      messages: toApiMessages(history, validateImage(req.body && req.body.image)),
    });

    let emitted = 0;
    const filter = createDeptTagFilter(
      (text) => { ensureHeaders(); emitted += text.length; res.write(text); },
      (header) => { ensureHeaders(); res.write(header); },
    );

    stream.on('text', (delta) => filter.feed(delta));

    const final = await stream.finalMessage();
    filter.flush();

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
