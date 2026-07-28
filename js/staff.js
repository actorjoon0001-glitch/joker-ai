/* AI 직원(팀 모드) — 분야별 직원을 등록해 두고 담당자를 골라 대화한다.
   담당자가 선택되면 그 직원의 전문성·말투로 응대하고(서버에서 페르소나 주입),
   조커가 쓰는 도구(노션·일정·문자·메일…)는 직원도 그대로 쓴다.
   저장은 Supabase(/api/staff) — 기기가 바뀌어도 팀이 유지된다.
   Exposes window.JokerStaff.{list, current, select, detect, refresh,
                              renderUI, saveFromUI, onChange}. */
(() => {
  'use strict';

  const PICK_KEY = 'joker.staff.pick.v1';
  const CACHE_KEY = 'joker.staff.cache.v1';
  const MAX_STAFF = 12;

  let staff = [];
  let pickedId = null;
  const listeners = [];

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (Array.isArray(cached)) staff = cached;
  } catch {}
  try {
    const v = Number(localStorage.getItem(PICK_KEY));
    if (Number.isInteger(v) && v > 0) pickedId = v;
  } catch {}

  const hasBackend = location.protocol !== 'file:';
  const emit = () => { for (const fn of listeners) { try { fn(); } catch {} } };

  function cache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(staff)); } catch {}
  }

  async function refresh() {
    if (!hasBackend) return staff;
    try {
      const r = await fetch('api/staff');
      if (!r.ok) return staff; /* 503(테이블 없음) 등은 캐시 그대로 */
      const list = (await r.json()).staff;
      if (Array.isArray(list)) {
        staff = list;
        cache();
        /* 지워진 직원이 선택돼 있었다면 조커로 되돌린다 */
        if (pickedId && !staff.some((s) => s.id === pickedId)) select(null);
        else emit();
      }
    } catch {}
    return staff;
  }

  function current() {
    if (!pickedId) return null;
    return staff.find((s) => s.id === pickedId) || null;
  }

  function select(id) {
    pickedId = id || null;
    try {
      if (pickedId) localStorage.setItem(PICK_KEY, String(pickedId));
      else localStorage.removeItem(PICK_KEY);
    } catch {}
    emit();
    return current();
  }

  /* "세리야 ~", "@세리 ~", "세리님 ~" 처럼 이름을 부르면 그 직원으로 전환.
     문장 앞부분에서만 찾아 오탐을 줄인다. */
  function detect(text) {
    if (!text || !staff.length) return null;
    const head = text.trim().slice(0, 24);
    for (const s of staff) {
      const n = (s.name || '').trim();
      if (n.length < 2) continue;
      const re = new RegExp('(^|[\\s,])@?' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '(님|씨|아|야|이|한테|에게|,|\\s|$)');
      if (re.test(head)) return s;
    }
    return null;
  }

  /* ── 설정 패널 TEAM 탭 ── */
  const listEl = () => document.getElementById('staffList');

  function row(s) {
    const wrap = document.createElement('div');
    wrap.className = 'staff-row';
    wrap.dataset.id = s.id || '';
    const depts = window.DEPTS || {};
    const options = ['<option value="">부서 없음</option>']
      .concat(Object.entries(depts).map(([k, d]) =>
        `<option value="${k}"${s.dept === k ? ' selected' : ''}>${d.name}</option>`))
      .join('');
    wrap.innerHTML =
      '<div class="staff-head">' +
      `<input class="ico" data-f="emoji" maxlength="4" value="${(s.emoji || '🙂').replace(/"/g, '')}" aria-label="이모지" />` +
      `<input class="nm" data-f="name" maxlength="40" placeholder="이름 (예: 세리)" value="${(s.name || '').replace(/"/g, '&quot;')}" />` +
      `<input class="rl" data-f="role" maxlength="60" placeholder="역할 (예: 마케팅 담당)" value="${(s.role || '').replace(/"/g, '&quot;')}" />` +
      `<select data-f="dept">${options}</select>` +
      '<button class="del" title="삭제">×</button>' +
      '</div>' +
      `<textarea data-f="persona" rows="3" maxlength="2000" placeholder="성격·말투·전문 분야를 적어주세요. 이 내용이 그 직원의 업무 지침이 됩니다."></textarea>`;
    wrap.querySelector('textarea').value = s.persona || '';
    wrap.querySelector('.del').addEventListener('click', async () => {
      wrap.remove();
      if (s.id) {
        try {
          await fetch('api/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'delete', id: s.id }),
          });
        } catch {}
        if (pickedId === s.id) select(null);
        await refresh();
      }
    });
    return wrap;
  }

  function render() {
    const el = listEl();
    if (!el) return;
    el.innerHTML = '';
    if (!staff.length) {
      const p = document.createElement('p');
      p.className = 'settings-desc';
      p.textContent = 'Supabase에서 setup.sql을 실행하면 기본 직원 6명이 들어옵니다. 직접 추가해도 됩니다.';
      el.appendChild(p);
    }
    for (const s of staff) el.appendChild(row(s));
  }

  function addBlank() {
    const el = listEl();
    if (!el || el.querySelectorAll('.staff-row').length >= MAX_STAFF) return;
    el.appendChild(row({ emoji: '🙂' }));
  }

  /* 설정 패널의 저장 버튼이 호출 — 추가·수정만 반영(삭제는 즉시 처리됨) */
  async function saveFromUI() {
    const el = listEl();
    if (!el || !hasBackend) return;
    const rows = [...el.querySelectorAll('.staff-row')];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const get = (f) => {
        const node = r.querySelector(`[data-f="${f}"]`);
        return node ? String(node.value || '').trim() : '';
      };
      const name = get('name');
      if (!name) continue;
      const id = Number(r.dataset.id) || null;
      const body = {
        op: id ? 'update' : 'add',
        id,
        name,
        role: get('role'),
        dept: get('dept'),
        emoji: get('emoji'),
        persona: get('persona'),
        sort: i + 1,
      };
      try {
        await fetch('api/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {}
    }
    await refresh();
  }

  const addBtn = document.getElementById('staffAdd');
  if (addBtn) addBtn.addEventListener('click', addBlank);

  window.JokerStaff = {
    list: () => staff,
    current,
    select,
    detect,
    refresh,
    renderUI: render,
    saveFromUI,
    onChange(fn) { if (typeof fn === 'function') listeners.push(fn); },
  };

  if (hasBackend) refresh();
})();
