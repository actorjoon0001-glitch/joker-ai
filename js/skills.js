/* Skills panel — user-defined task procedures (how Joker should do specific jobs).
   Unlike company memory (always injected), a skill is sent only when the user's
   message hits one of its trigger keywords. Stored in localStorage.
   Exposes window.JokerSkills.{match, renderUI, saveFromUI}. */
(() => {
  'use strict';

  const STORE_KEY = 'joker.skills.v1';
  const MAX_SKILLS = 20;
  const MAX_NAME = 40;
  const MAX_TRIGGERS = 200;
  const MAX_BODY = 4000;
  const MAX_ACTIVE = 3; /* most skills sent with a single request */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const list = raw ? JSON.parse(raw) : null;
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function save(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {}
  }

  let skills = load();

  /* the skill name always works as a trigger, on top of the user-listed keywords */
  function triggerWords(s) {
    return [s.name, ...(s.triggers || '').split(',')]
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length >= 2);
  }

  window.JokerSkills = {
    /* user message → matched skills [{name, body}] (best first), or null */
    match(text) {
      if (!text || !skills.length) return null;
      const t = text.toLowerCase();
      const scored = [];
      for (const s of skills) {
        if (!s || !(s.name || '').trim() || !(s.body || '').trim()) continue;
        let score = 0;
        for (const kw of triggerWords(s)) if (t.includes(kw)) score++;
        if (score) scored.push({ score, s });
      }
      if (!scored.length) return null;
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, MAX_ACTIVE).map(({ s }) => ({
        name: s.name.trim().slice(0, MAX_NAME),
        body: s.body.trim().slice(0, MAX_BODY),
      }));
    },
    renderUI: render,
    saveFromUI,
  };

  /* ── panel UI (SKILLS tab inside the settings panel) ── */
  const listEl = document.getElementById('skillList');
  const addBtn = document.getElementById('skillAdd');
  if (!listEl || !addBtn) return;

  function addCard(s = { name: '', triggers: '', body: '' }) {
    const card = document.createElement('div');
    card.className = 'skill-card';

    const row = document.createElement('div');
    row.className = 'skill-row';
    const nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.maxLength = MAX_NAME;
    nameIn.placeholder = '스킬 이름 (예: 주간보고)';
    nameIn.value = s.name || '';
    nameIn.dataset.role = 'name';
    const delBtn = document.createElement('button');
    delBtn.className = 'skill-del';
    delBtn.setAttribute('aria-label', '스킬 삭제');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => card.remove());
    row.append(nameIn, delBtn);

    const trigIn = document.createElement('input');
    trigIn.type = 'text';
    trigIn.maxLength = MAX_TRIGGERS;
    trigIn.placeholder = '발동 키워드 (쉼표로 구분 — 예: 주간보고, 한 주 정리, 주간회고)';
    trigIn.value = s.triggers || '';
    trigIn.dataset.role = 'triggers';

    const bodyTa = document.createElement('textarea');
    bodyTa.rows = 4;
    bodyTa.maxLength = MAX_BODY;
    bodyTa.placeholder = '지침 — 이 업무를 어떤 순서·양식·톤으로 처리할지 적어주세요.';
    bodyTa.value = s.body || '';
    bodyTa.dataset.role = 'body';

    card.append(row, trigIn, bodyTa);
    listEl.appendChild(card);
    return card;
  }

  function render() {
    listEl.innerHTML = '';
    skills.forEach(s => addCard(s));
  }

  function readCards() {
    const out = [];
    for (const card of listEl.querySelectorAll('.skill-card')) {
      const val = role =>
        (card.querySelector(`[data-role="${role}"]`).value || '').trim();
      const item = {
        name: val('name').slice(0, MAX_NAME),
        triggers: val('triggers').slice(0, MAX_TRIGGERS),
        body: val('body').slice(0, MAX_BODY),
      };
      if (item.name || item.body) out.push(item);
    }
    return out.slice(0, MAX_SKILLS);
  }

  function saveFromUI() {
    skills = readCards();
    save(skills);
  }

  addBtn.addEventListener('click', () => {
    if (listEl.querySelectorAll('.skill-card').length >= MAX_SKILLS) return;
    const card = addCard();
    card.querySelector('input').focus();
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
})();
