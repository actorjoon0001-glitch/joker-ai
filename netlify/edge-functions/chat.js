/* Netlify Edge Function for /api/chat — replaces the regular function for chat
   because Claude can take longer than the 10s function timeout to start
   answering hard questions. Edge functions stream without that limit.
   Raw fetch + SSE parsing (no SDK — this runs on Deno). */
import {
  MODEL_DEFAULT, OVERLOAD_LINE, sanitizeHistory, buildSystem, createDeptTagFilter,
} from '../../api/_lib/core.js';

const env = (k) =>
  (typeof Netlify !== 'undefined' && Netlify.env ? Netlify.env.get(k) : undefined) ??
  (globalThis.process && globalThis.process.env ? globalThis.process.env[k] : undefined);

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(request) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = await request.json(); } catch {}
  const history = sanitizeHistory(body.messages);
  if (!history) return json(400, { error: 'invalid_messages' });

  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return json(500, { error: 'server_not_configured' });

  const upstream = await fetch((env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env('JOKER_MODEL') || MODEL_DEFAULT,
      max_tokens: 2048,
      stream: true,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: buildSystem(body),
      messages: history,
    }),
  });

  if (!upstream.ok) {
    const status = upstream.status;
    console.error('[joker edge] upstream', status, await upstream.text().catch(() => ''));
    if (status === 401 || status === 403) return json(500, { error: 'server_not_configured' });
    if (status === 429) return json(429, { error: 'rate_limited' });
    if (status === 400) return json(500, { error: 'server_not_configured' }); /* e.g. no credit */
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
          sseBuf = lines.pop(); /* keep the trailing partial line */
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let ev;
            try { ev = JSON.parse(line.slice(6)); } catch { continue; }
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
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

export const config = { path: '/api/chat' };
