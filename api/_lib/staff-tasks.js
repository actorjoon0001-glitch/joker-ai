/* [[업무:직원이름|업무 내용]] 태그 처리 — 지시함(joker_staff_tasks)에 접수한다.
   실제 수행은 백그라운드 워커(api/staff-run.js)가 맡고, 여기서는 담당 직원을
   명부에서 찾아 pending 한 줄을 남기는 것까지만 한다. 이름이 명부에 없으면
   아무것도 저장하지 않고 not_found 카드를 돌려준다(엉뚱한 사람에게 배정되는
   것보다 조커가 다시 묻는 편이 낫다). */
import { sb } from './db.js';

export async function assignStaffTask(action) {
  const name = String(action.name || '').replace(/[%*]/g, '').trim().slice(0, 40);
  const request = String(action.request || '').trim().slice(0, 2000);
  const base = { kind: 'staff_task', name, request };
  if (!name || !request) return { ...base, status: 'error' };
  try {
    const q = await sb(
      `joker_staff?select=id,name,role,dept,emoji&name=ilike.${encodeURIComponent(name)}&limit=1`
    );
    if (q.status === 404) return { ...base, status: 'db_not_ready' };
    if (!q.ok) return { ...base, status: 'error' };
    const rows = await q.json().catch(() => []);
    if (!rows.length) return { ...base, status: 'not_found' };
    const s = rows[0];
    const r = await sb('joker_staff_tasks', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        staff_id: s.id,
        staff_name: s.name,
        staff_emoji: s.emoji || null,
        dept: s.dept || null,
        request,
      }),
    });
    if (r.status === 404) return { ...base, status: 'db_not_ready' };
    if (!r.ok) return { ...base, status: 'error' };
    const saved = (await r.json().catch(() => []))[0] || {};
    return {
      kind: 'staff_task',
      status: 'queued',
      id: saved.id || null,
      name: s.name,
      role: s.role || '',
      emoji: s.emoji || '',
      request,
    };
  } catch (err) {
    console.error('[joker staff task]', err);
    return { ...base, status: 'error' };
  }
}
