/* /api/tasks — 코워크 작업 큐 조회 (조커 프론트가 완료 알림용으로 폴링).
   GET                      → { tasks: [...] }  최근 7일, 최신순
   POST {op:'notified', id} → 알림 완료 표시
   작업 생성은 챗 백엔드([[코워크:...]] 태그)가, 실행·완료 처리는
   코워크(Claude)가 Supabase REST로 직접 한다. */
import { sb, isDbNotReady } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const r = await sb(
        `joker_tasks?select=*&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=50`
      );
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ tasks: await r.json() });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.op === 'notified') {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
        const r = await sb(`joker_tasks?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notified: true }),
        });
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: 'invalid_op' });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker tasks]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
