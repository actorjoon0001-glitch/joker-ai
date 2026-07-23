/* /api/events — 일정·리마인더 저장소 (Supabase joker_events).
   GET             → { events: [...] }  최근 24시간~미래의 일정, due_at 오름차순
   POST {title, due_at, kind}          → 등록 { ok, event }
   POST {op:'notified', id}            → 알림 완료 표시
   POST {op:'delete', id}              → 삭제
   503 db_not_ready until setup.sql is run. */
import { sb, isDbNotReady } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const r = await sb(
        `joker_events?select=*&due_at=gte.${encodeURIComponent(since)}&order=due_at.asc&limit=100`
      );
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ events: await r.json() });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.op === 'notified' || b.op === 'delete') {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
        const r = b.op === 'delete'
          ? await sb(`joker_events?id=eq.${id}`, { method: 'DELETE' })
          : await sb(`joker_events?id=eq.${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ notified: true }),
            });
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
      const kind = b.kind === 'event' ? 'event' : 'reminder';
      const due = new Date(b.due_at || '');
      if (!title || isNaN(due.getTime())) { res.status(400).json({ error: 'invalid_event' }); return; }
      const r = await sb('joker_events', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title, kind, due_at: due.toISOString() }),
      });
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      const rows = await r.json().catch(() => []);
      res.status(200).json({ ok: true, event: rows[0] || null });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker events]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
