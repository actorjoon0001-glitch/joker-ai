/* In-site calendar panel — month grid of joker_events (일정·리마인더), fed by
   window.JokerEvents' cache. Open via the header 📅 button or an action chip's
   "캘린더 보기". Exposes window.JokerCalendar.{open, close}. */
(() => {
  'use strict';

  const panel = document.getElementById('calendarPanel');
  const backdrop = document.getElementById('panelBackdrop');
  const openBtn = document.getElementById('calendarBtn');
  const closeBtn = document.getElementById('calendarClose');
  const titleEl = document.getElementById('calTitle');
  const gridEl = document.getElementById('calGrid');
  const listEl = document.getElementById('calList');
  const prevBtn = document.getElementById('calPrev');
  const nextBtn = document.getElementById('calNext');
  if (!panel || !gridEl) return;

  const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }); /* YYYY-MM-DD */
  const KST_TIME = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  let view = null;      /* {y, m} — displayed month (1-based) */
  let selected = null;  /* 'YYYY-MM-DD' */

  const todayKey = () => KST_DATE.format(new Date());
  const dateKey = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : KST_DATE.format(d);
  };

  function eventsByDay() {
    const map = {};
    const list = window.JokerEvents ? window.JokerEvents.list() : [];
    for (const e of list) {
      if (!e || !e.title) continue;
      const key = dateKey(e.due_at);
      if (!key) continue;
      (map[key] = map[key] || []).push(e);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    }
    return map;
  }

  function render() {
    if (!view) return;
    const { y, m } = view;
    titleEl.textContent = `${y}년 ${m}월`;
    const byDay = eventsByDay();
    const today = todayKey();
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    gridEl.innerHTML = '';
    for (const w of ['일', '월', '화', '수', '목', '금', '토']) {
      const h = document.createElement('div');
      h.className = 'cal-dow';
      h.textContent = w;
      gridEl.appendChild(h);
    }
    for (let i = 0; i < firstDow; i++) {
      gridEl.appendChild(document.createElement('div'));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = document.createElement('button');
      cell.className = 'cal-day';
      if (key === today) cell.classList.add('today');
      if (key === selected) cell.classList.add('selected');
      const num = document.createElement('span');
      num.textContent = d;
      cell.appendChild(num);
      const items = byDay[key] || [];
      if (items.length) {
        const dots = document.createElement('span');
        dots.className = 'cal-dots';
        for (const e of items.slice(0, 3)) {
          const dot = document.createElement('i');
          dot.className = e.kind === 'event' ? 'ev' : 'rm';
          dots.appendChild(dot);
        }
        cell.appendChild(dots);
      }
      cell.addEventListener('click', () => { selected = key; render(); });
      gridEl.appendChild(cell);
    }

    /* selected-day detail list */
    listEl.innerHTML = '';
    const items = (selected && byDay[selected]) || [];
    if (!selected) {
      listEl.innerHTML = '<p class="cal-empty">날짜를 누르면 그날의 일정이 보여요.</p>';
    } else if (!items.length) {
      listEl.innerHTML = '<p class="cal-empty">이 날은 등록된 일정이 없어요.</p>';
    } else {
      for (const e of items) {
        const row = document.createElement('div');
        row.className = 'cal-item';
        const ico = document.createElement('span');
        ico.className = 'ico';
        ico.textContent = e.kind === 'event' ? '📅' : '⏰';
        const body = document.createElement('div');
        body.className = 'body';
        const t = document.createElement('b');
        t.textContent = e.title;
        const when = document.createElement('span');
        when.textContent = KST_TIME.format(new Date(e.due_at));
        body.append(t, when);
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '×';
        del.title = '삭제';
        del.addEventListener('click', async () => {
          del.disabled = true;
          try {
            await fetch('api/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ op: 'delete', id: e.id }),
            });
          } catch {}
          if (window.JokerEvents) await window.JokerEvents.refresh();
          render();
        });
        row.append(ico, body, del);
        listEl.appendChild(row);
      }
    }
  }

  function shiftMonth(delta) {
    let { y, m } = view;
    m += delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    view = { y, m };
    render();
  }

  async function open(dateStr) {
    const base = dateStr || todayKey();
    const p = base.split('-').map(Number);
    view = { y: p[0], m: p[1] };
    selected = dateStr || todayKey();
    panel.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add('open');
      backdrop.classList.add('open');
    });
    render(); /* draw immediately from cache… */
    if (window.JokerEvents) {
      await window.JokerEvents.refresh(); /* …then repaint with fresh data */
      render();
    }
  }

  function close() {
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      panel.hidden = true;
      /* leave the backdrop to whichever panel still uses it */
      if (!document.querySelector('.settings.open')) backdrop.hidden = true;
    }, 300);
  }

  if (openBtn) openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (prevBtn) prevBtn.addEventListener('click', () => shiftMonth(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => shiftMonth(1));
  if (backdrop) backdrop.addEventListener('click', close);

  window.JokerCalendar = { open, close };
})();
