/* GET /api/memory  → { data: {company, depts} }  — company memory from Supabase
   POST /api/memory { data } → upsert. 503 db_not_ready until setup.sql is run. */
import { sb, isDbNotReady } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const r = await sb('joker_memory?id=eq.1&select=data');
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      const rows = await r.json();
      res.status(200).json({ data: (rows[0] && rows[0].data) || {} });
      return;
    }

    if (req.method === 'POST') {
      const data = req.body && req.body.data;
      if (!data || typeof data !== 'object') { res.status(400).json({ error: 'invalid_data' }); return; }
      const clip = (s) => (typeof s === 'string' ? s.slice(0, 2000) : '');
      const clean = {
        company: clip(data.company),
        depts: Object.fromEntries(
          Object.entries(data.depts || {})
            .filter(([k]) => /^[a-z]{1,20}$/.test(k))
            .slice(0, 20)
            .map(([k, v]) => [k, clip(v)])
        ),
      };
      const r = await sb('joker_memory', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: 1, data: clean, updated_at: new Date().toISOString() }),
      });
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker memory]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
