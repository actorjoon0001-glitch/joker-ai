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
import {
  notionEnv, resolveTarget, searchPages, listBlocks, blocksToText, appendBlocks, replaceBlocks,
} from './_lib/notion.js';

const MODEL = process.env.JOKER_MODEL || MODEL_DEFAULT;

/* [[코워크:요청]] tag → 작업 큐 row (best-effort) */
async function saveTask(request) {
  try {
    const r = await sb('joker_tasks', {
      method: 'POST',
      body: JSON.stringify({ request: String(request).slice(0, 2000) }),
    });
    if (!r.ok) console.error('[joker api] task save failed', r.status);
  } catch (err) {
    console.error('[joker api] task save', err);
  }
}

/* [[투두:내용]] tag → joker_todos row (best-effort) */
async function saveTodo(title) {
  try {
    const r = await sb('joker_todos', {
      method: 'POST',
      body: JSON.stringify({ title: String(title).slice(0, 200) }),
    });
    if (!r.ok) console.error('[joker api] todo save failed', r.status);
  } catch (err) {
    console.error('[joker api] todo save', err);
  }
}

/* [[투두완료:키워드]] tag → mark the first matching open todo done; returns
   the result the client renders */
async function completeTodo(keyword) {
  try {
    const kw = String(keyword).replace(/[%*]/g, '').trim().slice(0, 100);
    if (!kw) return { kind: 'todo_done', title: String(keyword), status: 'not_found' };
    const q = await sb(
      `joker_todos?select=id,title&done=eq.false&title=ilike.${encodeURIComponent('*' + kw + '*')}` +
      '&order=created_at.asc&limit=1'
    );
    if (!q.ok) return { kind: 'todo_done', title: kw, status: 'error' };
    const rows = await q.json().catch(() => []);
    if (!rows.length) return { kind: 'todo_done', title: kw, status: 'not_found' };
    const r = await sb(`joker_todos?id=eq.${rows[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: true, done_at: new Date().toISOString() }),
    });
    if (!r.ok) return { kind: 'todo_done', title: rows[0].title, status: 'error' };
    return { kind: 'todo_done', title: rows[0].title, status: 'ok' };
  } catch (err) {
    console.error('[joker api] todo done', err);
    return { kind: 'todo_done', title: String(keyword), status: 'error' };
  }
}

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

/* [[노션검색/읽기/추가/수정/삭제:...]] tags → Notion page op; returns the
   result object the client renders as a card. notion_delete performs NO
   write here — it only resolves the target so the client can show a
   confirmation card; the actual archive happens via POST /api/notion after
   the user confirms. */
async function runNotionOp(action) {
  const env = notionEnv();
  const base = { kind: action.kind, title: action.target || action.query || '' };
  if (!env.configured) return { ...base, status: 'not_configured' };
  try {
    if (action.kind === 'notion_search') {
      const results = await searchPages(env, action.query);
      return { kind: 'notion_search', status: 'ok', query: action.query, results };
    }
    const r = await resolveTarget(env, action.target);
    if (!r.page) return { ...base, status: r.status, candidates: r.candidates };
    const page = r.page;
    if (action.kind === 'notion_read') {
      const content = blocksToText(await listBlocks(env, page.id));
      return { kind: 'notion_read', status: 'ok', page, content };
    }
    if (action.kind === 'notion_append') {
      await appendBlocks(env, page.id, action.content);
      return { kind: 'notion_append', status: 'ok', page };
    }
    if (action.kind === 'notion_update') {
      const status = await replaceBlocks(env, page.id, action.content);
      return { kind: 'notion_update', status, page };
    }
    if (action.kind === 'notion_delete') {
      return { kind: 'notion_delete', status: 'confirm', page };
    }
    return { ...base, status: 'error' };
  } catch (err) {
    console.error('[joker notion op]', action.kind, err);
    return { ...base, status: 'error' };
  }
}

const CTRL = String.fromCharCode(0); /* NUL frame for control headers */

/* per-turn token/search usage → joker_usage row (best-effort) */
async function saveUsage(usage) {
  if (!usage) return;
  try {
    const r = await sb('joker_usage', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'turn',
        model: MODEL,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        searches: (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0,
      }),
    });
    if (!r.ok) console.error('[joker api] usage save failed', r.status);
  } catch (err) {
    console.error('[joker api] usage save', err);
  }
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
      system: buildSystem(req.body),
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
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
        } else if (action.kind.indexOf('notion_') === 0) {
          pendingWrites.push(runNotionOp(action).then((result) => {
            ensureHeaders();
            res.write(CTRL + 'action:' + JSON.stringify(result) + CTRL);
          }).catch((e) => console.error('[joker api] notion op', e)));
        } else if (action.kind === 'todo') {
          pendingWrites.push(saveTodo(action.title));
        } else if (action.kind === 'todo_done') {
          pendingWrites.push(completeTodo(action.title).then((result) => {
            ensureHeaders();
            res.write(CTRL + 'action:' + JSON.stringify(result) + CTRL);
          }).catch((e) => console.error('[joker api] todo done', e)));
        } else if (action.kind === 'cowork') {
          pendingWrites.push(saveTask(action.request));
        } else if (action.kind === 'event' || action.kind === 'reminder') {
          pendingWrites.push(saveEvent(action).catch((e) => console.error('[joker api] event', e)));
        }
      },
    );

    stream.on('text', (delta) => filter.feed(delta));

    const final = await stream.finalMessage();
    filter.flush();
    pendingWrites.push(saveUsage(final.usage));
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
    } else if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(String(err.message))) {
      res.status(402).json({ error: 'no_credits' });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: 'upstream_error' });
    } else {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

export const config = { supportsResponseStreaming: true, maxDuration: 60 };
