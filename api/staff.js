/* /api/staff — AI 직원(팀 모드) 명부 (Supabase joker_staff).
   GET                                   → { staff: [...] }
   POST {op:'add', name, role, dept, emoji, persona}
   POST {op:'update', id, ...같은 필드}
   POST {op:'delete', id}
   503 db_not_ready until setup.sql is run. */
import { sb, isDbNotReady } from './_lib/db.js';

const MAX = { name: 40, role: 60, emoji: 8, persona: 2000 };

function fields(b) {
  const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const row = {
    name: clip(b.name, MAX.name),
    role: clip(b.role, MAX.role),
    emoji: clip(b.emoji, MAX.emoji),
    persona: clip(b.persona, MAX.persona),
  };
  const dept = clip(b.dept, 20);
  row.dept = dept || null;
  if (Number.isFinite(Number(b.sort))) row.sort = Number(b.sort);
  return row;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const r = await sb('joker_staff?select=*&order=sort.asc,id.asc&limit=50');
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ staff: await r.json() });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.op === 'add' || b.op === 'update') {
        const row = fields(b);
        if (!row.name) { res.status(400).json({ error: 'invalid_name' }); return; }
        let r;
        if (b.op === 'add') {
          r = await sb('joker_staff', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(row),
          });
        } else {
          const id = Number(b.id);
          if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
          r = await sb(`joker_staff?id=eq.${id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(row),
          });
        }
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        const rows = await r.json().catch(() => []);
        res.status(200).json({ ok: true, staff: rows[0] || null });
        return;
      }

      if (b.op === 'delete') {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
        const r = await sb(`joker_staff?id=eq.${id}`, { method: 'DELETE' });
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
    console.error('[joker staff]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
