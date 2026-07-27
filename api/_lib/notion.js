/* Shared Notion helpers for Joker's page operations: search, read, append,
   update(replace), archive. Used by api/chat.js (tag execution) and
   api/notion.js (user-confirmed archive endpoint).
   NOTE: mirrored inline in netlify/edge-functions/chat.js — keep in sync. */

const NOTION_VERSION = '2022-06-28';

export function notionEnv() {
  const key = process.env.NOTION_API_KEY;
  const parent = process.env.NOTION_PARENT_PAGE_ID;
  const base = process.env.NOTION_BASE_URL || 'https://api.notion.com';
  return { key, parent, base, configured: Boolean(key && parent) };
}

async function nfetch(env, path, opts = {}) {
  const r = await fetch(env.base + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + env.key,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[joker notion]', path, r.status, JSON.stringify(j).slice(0, 300));
    const e = new Error('notion_' + r.status);
    e.status = r.status;
    throw e;
  }
  return j;
}

/* Accepts a bare page id (dashed or not) or a notion.so/site URL; a plain
   title returns null so callers fall back to title search. */
export function extractPageId(target) {
  const t = String(target || '').trim();
  const bare = t.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(bare)) return bare.toLowerCase();
  if (/notion\.(?:so|site|com)\//i.test(t)) {
    const m = t.match(/([0-9a-f]{32})(?:[^0-9a-f]|$)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function pageTitle(page) {
  try {
    const prop = Object.values(page.properties || {}).find((p) => p && p.type === 'title');
    const t = ((prop && prop.title) || []).map((x) => x.plain_text || '').join('').trim();
    return t || '(제목 없음)';
  } catch {
    return '(제목 없음)';
  }
}

export async function searchPages(env, query) {
  const j = await nfetch(env, '/v1/search', {
    method: 'POST',
    body: JSON.stringify({
      query: String(query).slice(0, 100),
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    }),
  });
  return (j.results || [])
    .filter((r) => r && r.object === 'page' && !r.archived)
    .map((p) => ({ id: p.id.replace(/-/g, ''), title: pageTitle(p), url: p.url || null }));
}

/* target(id/URL/title) → {page:{id,title,url}} | {status:'not_found'} |
   {status:'choose', candidates}. A title only auto-resolves when unambiguous. */
export async function resolveTarget(env, target) {
  const id = extractPageId(target);
  if (id) {
    try {
      const page = await nfetch(env, '/v1/pages/' + id);
      if (page.archived) return { status: 'not_found' };
      return { page: { id, title: pageTitle(page), url: page.url || null } };
    } catch {
      return { status: 'not_found' };
    }
  }
  const results = await searchPages(env, target);
  if (!results.length) return { status: 'not_found' };
  const wanted = String(target).trim();
  const exact = results.filter((r) => r.title.trim() === wanted);
  if (exact.length === 1) return { page: exact[0] };
  if (results.length === 1) return { page: results[0] };
  return { status: 'choose', candidates: results };
}

const TEXT_BLOCKS = {
  paragraph: '', heading_1: '# ', heading_2: '## ', heading_3: '### ',
  bulleted_list_item: '- ', numbered_list_item: '- ', to_do: '☐ ',
  quote: '> ', callout: '', toggle: '',
};

export async function listBlocks(env, pageId) {
  const j = await nfetch(env, '/v1/blocks/' + pageId + '/children?page_size=100');
  return j.results || [];
}

export function blocksToText(blocks, cap = 3000) {
  const lines = [];
  for (const b of blocks) {
    if (!b || typeof b.type !== 'string') continue;
    if (b.type === 'divider') { lines.push('---'); continue; }
    if (!(b.type in TEXT_BLOCKS)) continue;
    const conf = b[b.type];
    const txt = ((conf && conf.rich_text) || []).map((x) => x.plain_text || '').join('');
    if (txt.trim()) lines.push(TEXT_BLOCKS[b.type] + txt);
  }
  let out = lines.join('\n');
  if (out.length > cap) out = out.slice(0, cap) + '\n…(이하 생략)';
  return out;
}

export function contentToBlocks(content) {
  return String(content).split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 30)
    .map((t) => ({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 1800) } }] },
    }));
}

export async function appendBlocks(env, pageId, content) {
  await nfetch(env, '/v1/blocks/' + pageId + '/children', {
    method: 'PATCH',
    body: JSON.stringify({ children: contentToBlocks(content) }),
  });
}

/* Replace the page body: delete existing blocks (Notion keeps them restorable
   via page history) then append the new content. Pages over 30 blocks are
   refused ('too_big') — both as a safety cap and to stay inside Notion's
   rate limit with the sequential deletes. */
export async function replaceBlocks(env, pageId, content) {
  const blocks = await listBlocks(env, pageId);
  if (blocks.length > 30) return 'too_big';
  for (const b of blocks) {
    await nfetch(env, '/v1/blocks/' + b.id, { method: 'DELETE' });
  }
  await appendBlocks(env, pageId, content);
  return 'ok';
}

/* All pages the integration can reach, newest-edited first — feeds the
   always-on Notion list panel in the web UI. */
export async function listPages(env, limit = 20) {
  const j = await nfetch(env, '/v1/search', {
    method: 'POST',
    body: JSON.stringify({
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: Math.min(50, Math.max(1, limit)),
    }),
  });
  return (j.results || [])
    .filter((r) => r && r.object === 'page' && !r.archived)
    .map((p) => ({
      id: p.id.replace(/-/g, ''),
      title: pageTitle(p),
      url: p.url || null,
      edited: p.last_edited_time || null,
    }));
}

/* Archive = Notion trash (restorable). Single page per call by design. */
export async function archivePage(env, pageId) {
  await nfetch(env, '/v1/pages/' + pageId, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}
