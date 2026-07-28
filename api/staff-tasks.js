/* /api/staff-tasks — AI 직원 업무 지시함 조회.
   GET                      → { tasks: [...] }  최근 3일, 최신순
   POST {op:'notified', id} → 완료 알림 표시(중복 알림 방지)
   접수는 챗 백엔드([[업무:...]] 태그)가, 실행은 워커(api/staff-run.js)가 한다.
   503 db_not_ready until setup.sql is run. */
import { sb, isDbNotReady } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
      const r = await sb(
        'joker_staff_tasks?select=id,staff_id,staff_name,staff_emoji,dept,request,status,result,' +
        `notion_url,notified,created_at,updated_at&created_at=gte.${encodeURIComponent(since)}` +
        '&order=created_at.desc&limit=30'
      );
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ tasks: await r.json() });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.op !== 'notified') { res.status(400).json({ error: 'invalid_op' }); return; }
      const id = Number(b.id);
      if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'invalid_id' }); return; }
      const r = await sb(`joker_staff_tasks?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notified: true }),
      });
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker staff tasks]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
