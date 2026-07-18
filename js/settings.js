/* Company memory panel — lets the owner register company/department knowledge
   from the page itself. Stored in localStorage and sent with each chat request;
   the backend injects it into Joker's system prompt.
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

  window.JokerKnowledge = {
    get() {
      const hasAny = (knowledge.company || '').trim() ||
        Object.values(knowledge.depts || {}).some(v => (v || '').trim());
      return hasAny ? knowledge : null;
    },
  };

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

  function open() {
    companyTa.value = knowledge.company || '';
    for (const ta of deptTas) ta.value = (knowledge.depts || {})[ta.dataset.dept] || '';
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

  function doSave() {
    knowledge = {
      company: companyTa.value.trim().slice(0, MAX_FIELD),
      depts: Object.fromEntries(
        deptTas.map(ta => [ta.dataset.dept, ta.value.trim().slice(0, MAX_FIELD)])
      ),
    };
    save(knowledge);
    saveBtn.textContent = '저장 완료 ✓';
    saveBtn.classList.add('saved');
    setTimeout(() => {
      saveBtn.textContent = '저장';
      saveBtn.classList.remove('saved');
      close();
    }, 900);
  }

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  saveBtn.addEventListener('click', doSave);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
})();
