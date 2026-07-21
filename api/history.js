/* GET  /api/history?limit=30 → { messages: [{role, content, dept}] } (oldest first)
   POST /api/history { messages } → append turns. 503 db_not_ready until setup.sql runs. */
import { sb, isDbNotReady } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query && req.query.limit, 10) || 30, 100);
      const r = await sb(`joker_messages?select=role,content,dept&order=id.desc&limit=${limit}`);
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      const rows = await r.json();
      res.status(200).json({ messages: rows.reverse() });
      return;
    }

    if (req.method === 'POST') {
      const msgs = req.body && req.body.messages;
      if (!Array.isArray(msgs) || !msgs.length || msgs.length > 4) {
        res.status(400).json({ error: 'invalid_messages' });
        return;
      }
      const clean = [];
      for (const m of msgs) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
        if (typeof m.content !== 'string' || !m.content.trim()) continue;
        clean.push({
          role: m.role,
          content: m.content.slice(0, 8000),
          dept: typeof m.dept === 'string' && /^[a-z]{1,20}$/.test(m.dept) ? m.dept : null,
        });
      }
      if (!clean.length) { res.status(400).json({ error: 'invalid_messages' }); return; }
      const r = await sb('joker_messages', { method: 'POST', body: JSON.stringify(clean) });
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const r = await sb('joker_messages?id=gt.0', { method: 'DELETE' });
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker history]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
