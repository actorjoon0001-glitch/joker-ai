/* Settings panel (MEMORY / SKILLS tabs). This file owns the panel shell, tab
   switching, and the company-memory tab: knowledge is stored in localStorage and
   sent with each chat request; the backend injects it into Joker's system prompt.
   The SKILLS tab content is managed by skills.js.
   Exposes window.JokerKnowledge.get(). */
(() => {
  'use strict';

  const STORE_KEY = 'joker.knowledge.v1';
  const MAX_FIELD = 2000;

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const k = raw ? JSON.parse(raw) : null;
      return k && typeof k === 'object' ? k : { company: '', depts: {} };
    } catch {
      return { company: '', depts: {} };
    }
  }

  function save(k) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(k)); } catch {}
  }

  let knowledge = load();
  const hasBackend = location.protocol !== 'file:';

  window.JokerKnowledge = {
    get() {
      const hasAny = (knowledge.company || '').trim() ||
        Object.values(knowledge.depts || {}).some(v => (v || '').trim());
      return hasAny ? knowledge : null;
    },
  };

  /* pull the shared copy from the server (Supabase) — wins over localStorage
     so edits made on another device show up here */
  if (hasBackend) {
    fetch('api/memory').then(r => (r.ok ? r.json() : null)).then(j => {
      if (j && j.data && typeof j.data === 'object' &&
          ((j.data.company || '').trim() || Object.values(j.data.depts || {}).some(v => (v || '').trim()))) {
        knowledge = { company: j.data.company || '', depts: j.data.depts || {} };
        save(knowledge);
      }
    }).catch(() => {});
  }

  /* ── panel UI ── */
  const btn = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const backdrop = document.getElementById('panelBackdrop');
  const closeBtn = document.getElementById('settingsClose');
  const saveBtn = document.getElementById('settingsSave');
  const fields = document.getElementById('settingsFields');
  if (!btn || !panel) return;

  /* build one textarea per department under the shared company field */
  for (const [key, d] of Object.entries(window.DEPTS)) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML =
      `<label><span class="dot" style="color:${d.color}"></span>${d.name}</label>` +
      `<textarea data-dept="${key}" rows="2" maxlength="${MAX_FIELD}" ` +
      `placeholder="${d.name} 관련 진행 중인 일, 담당 업체, 자주 쓰는 정보…"></textarea>`;
    fields.appendChild(wrap);
  }

  const companyTa = document.getElementById('know-company');
  const deptTas = [...fields.querySelectorAll('textarea[data-dept]')];

  /* MEMORY / SKILLS tabs */
  const titleEl = document.getElementById('settingsTitle');
  const tabBtns = [...document.querySelectorAll('#settingsTabs button')];
  const panes = {
    memory: document.getElementById('paneMemory'),
    skills: document.getElementById('paneSkills'),
  };
  const TITLES = { memory: 'COMPANY MEMORY', skills: 'SKILLS' };

  function setTab(name) {
    for (const b of tabBtns) b.classList.toggle('active', b.dataset.tab === name);
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== name;
    if (titleEl) titleEl.textContent = TITLES[name] || TITLES.memory;
  }
  for (const b of tabBtns) b.addEventListener('click', () => setTab(b.dataset.tab));

  function open() {
    companyTa.value = knowledge.company || '';
    for (const ta of deptTas) ta.value = (knowledge.depts || {})[ta.dataset.dept] || '';
    if (window.JokerSkills) window.JokerSkills.renderUI(); /* discard unsaved edits */
    panel.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add('open');
      backdrop.classList.add('open');
    });
  }

  function close() {
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => { panel.hidden = true; backdrop.hidden = true; }, 300);
  }

  async function doSave() {
    knowledge = {
      company: companyTa.value.trim().slice(0, MAX_FIELD),
      depts: Object.fromEntries(
        deptTas.map(ta => [ta.dataset.dept, ta.value.trim().slice(0, MAX_FIELD)])
      ),
    };
    save(knowledge);
    if (window.JokerSkills) window.JokerSkills.saveFromUI();

    let synced = false;
    if (hasBackend) {
      try {
        const r = await fetch('api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: knowledge }),
        });
        synced = r.ok;
      } catch {}
    }

    saveBtn.textContent = synced ? '저장 완료 ✓ (모든 기기 공유)' : '저장 완료 ✓ (이 브라우저)';
    saveBtn.classList.add('saved');
    setTimeout(() => {
      saveBtn.textContent = '저장';
      saveBtn.classList.remove('saved');
      close();
    }, 1200);
  }

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  saveBtn.addEventListener('click', doSave);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
})();
