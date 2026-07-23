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
import { sb } from './_lib/db.js';

const MODEL = process.env.JOKER_MODEL || MODEL_DEFAULT;

/* [[일정/리마인더]] tag from the stream → Supabase row (best-effort) */
async function saveEvent(action) {
  const dueAt = `${action.date}T${action.time}:00+09:00`;
  if (isNaN(new Date(dueAt).getTime())) return;
  const r = await sb('joker_events', {
    method: 'POST',
    body: JSON.stringify({ kind: action.kind, title: action.title, due_at: dueAt }),
  });
  if (!r.ok) console.error('[joker api] event save failed', r.status);
}

/* [[노션:제목|내용]] tag → Notion page; returns the result the client renders */
async function saveNotion(action) {
  const key = process.env.NOTION_API_KEY;
  const parent = process.env.NOTION_PARENT_PAGE_ID;
  if (!key || !parent) return { kind: 'notion', title: action.title, status: 'not_configured' };
  try {
    const children = action.content.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 30)
      .map((t) => ({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 1800) } }] },
      }));
    const base = process.env.NOTION_BASE_URL || 'https://api.notion.com';
    const r = await fetch(base + '/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { page_id: parent.replace(/-/g, '') },
        properties: { title: { title: [{ type: 'text', text: { content: action.title.slice(0, 200) } }] } },
        children,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[joker notion]', r.status, JSON.stringify(j).slice(0, 300));
      return { kind: 'notion', title: action.title, status: 'error' };
    }
    return { kind: 'notion', title: action.title, status: 'saved', url: j.url || null };
  } catch (err) {
    console.error('[joker notion]', err);
    return { kind: 'notion', title: action.title, status: 'error' };
  }
}

const CTRL = String.fromCharCode(0); /* NUL frame for control headers */

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
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: toApiMessages(history, validateImage(req.body && req.body.image)),
    });

    let emitted = 0;
    const pendingWrites = [];
    const filter = createDeptTagFilter(
      (text) => { ensureHeaders(); emitted += text.length; res.write(text); },
      (header) => { ensureHeaders(); res.write(header); },
      (action) => {
        if (action.kind === 'notion') {
          /* result header (saved/not_configured/error + url) goes out once the
             Notion call resolves — the stream stays open until finalMessage */
          pendingWrites.push(saveNotion(action).then((result) => {
            ensureHeaders();
            res.write(CTRL + 'action:' + JSON.stringify(result) + CTRL);
          }).catch((e) => console.error('[joker api] notion', e)));
        } else {
          pendingWrites.push(saveEvent(action).catch((e) => console.error('[joker api] event', e)));
        }
      },
    );

    stream.on('text', (delta) => filter.feed(delta));

    const final = await stream.finalMessage();
    filter.flush();
    await Promise.all(pendingWrites);

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
