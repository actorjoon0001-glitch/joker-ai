/* /api/todos — 할 일 목록 (Supabase joker_todos).
   GET                      → { todos: [...] }  미완료 전체 + 최근 7일 완료분
   POST {op:'add', title}   → 등록 { ok, todo }
   POST {op:'done'|'undone'|'delete', id}
   503 db_not_ready until setup.sql is run. */
import { sb, isDbNotReady } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const r = await sb(
        `joker_todos?select=*&or=(done.eq.false,done_at.gte.${encodeURIComponent(since)})` +
        '&order=done.asc,created_at.desc&limit=100'
      );
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ todos: await r.json() });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.op === 'add') {
        const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
        if (!title) { res.status(400).json({ error: 'invalid_title' }); return; }
        const r = await sb('joker_todos', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ title }),
        });
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        const rows = await r.json().catch(() => []);
        res.status(200).json({ ok: true, todo: rows[0] || null });
        return;
      }

      if (b.op === 'done' || b.op === 'undone' || b.op === 'delete') {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
        const r = b.op === 'delete'
          ? await sb(`joker_todos?id=eq.${id}`, { method: 'DELETE' })
          : await sb(`joker_todos?id=eq.${id}`, {
              method: 'PATCH',
              body: JSON.stringify(
                b.op === 'done'
                  ? { done: true, done_at: new Date().toISOString() }
                  : { done: false, done_at: null }
              ),
            });
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'bad_op' });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker todos]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
