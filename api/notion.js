/* /api/notion — direct Notion endpoints for the web UI.
   GET  ?op=list  → pages the integration can reach (Notion list panel).
   POST {op:'archive', page_id} → move ONE page to Notion's trash (restorable),
   only after the user pressed the confirmation card that a [[노션삭제:...]]
   tag produced. Everything else Joker does with Notion runs inside the chat
   stream handler. */
import { notionEnv, archivePage, extractPageId, listPages } from './_lib/notion.js';

export default async function handler(req, res) {
  const env = notionEnv();
  if (req.method === 'GET') {
    if ((req.query && req.query.op) !== 'list') {
      res.status(400).json({ error: 'bad_op' });
      return;
    }
    if (!env.configured) {
      res.status(501).json({ error: 'not_configured' });
      return;
    }
    try {
      res.status(200).json({ pages: await listPages(env, 20) });
    } catch (err) {
      console.error('[joker notion list]', err);
      res.status(502).json({ error: 'notion_error' });
    }
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!env.configured) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }
  const body = req.body || {};
  if (body.op !== 'archive') {
    res.status(400).json({ error: 'bad_op' });
    return;
  }
  /* single page id only — bulk delete is intentionally impossible here */
  const id = typeof body.page_id === 'string' ? extractPageId(body.page_id) : null;
  if (!id) {
    res.status(400).json({ error: 'bad_page_id' });
    return;
  }
  try {
    await archivePage(env, id);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[joker notion archive]', err);
    res.status(502).json({ error: 'notion_error' });
  }
}
