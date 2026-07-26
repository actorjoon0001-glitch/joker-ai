/* POST /api/notion — executes a user-confirmed Notion operation from the chat
   UI. Deliberately minimal: only 'archive' (move ONE page to Notion's trash,
   restorable) is supported, and only after the user pressed the confirmation
   card that a [[노션삭제:...]] tag produced. Everything else Joker does with
   Notion runs inside the chat stream handler. */
import { notionEnv, archivePage, extractPageId } from './_lib/notion.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const env = notionEnv();
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
