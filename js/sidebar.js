/* Left quick sidebar — always-on view of things 상준님 checks often:
   ① Notion pages Joker can reach (GET /api/notion?op=list, newest first)
   ② upcoming events/reminders (from window.JokerEvents' cache).
   The open state persists across reloads (localStorage); first visit opens it
   automatically on wide screens. Clicking a Notion title opens the page in
   Notion, 💬 asks Joker to read it; clicking an event opens the calendar. */
(() => {
  'use strict';

  const OPEN_KEY = 'joker.sidebar.v1';
  const NOTION_REFRESH_MS = 90000;
  const EVENTS_REFRESH_MS = 60000;

  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sbToggle');
  const closeBtn = document.getElementById('sbClose');
  const briefBtn = document.getElementById('sbBrief');
  const notionRefreshBtn = document.getElementById('sbNotionRefresh');
  const notionItems = document.getElementById('sbNotionItems');
  const calOpenBtn = document.getElementById('sbCalOpen');
  const eventItems = document.getElementById('sbEventItems');
  const calTitle = document.getElementById('sbCalTitle');
  const calGrid = document.getElementById('sbCalGrid');
  const calPrev = document.getElementById('sbCalPrev');
  const calNext = document.getElementById('sbCalNext');
  const todoItems = document.getElementById('sbTodoItems');
  const todoAddBtn = document.getElementById('sbTodoAddBtn');
  const todoAddWrap = document.getElementById('sbTodoAdd');
  const todoInput = document.getElementById('sbTodoInput');
  if (!sidebar || !notionItems || !eventItems) return;

  const hasBackend = location.protocol !== 'file:';
  let notionTimer = null;
  let eventsTimer = null;

  const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
  const SHORT_FMT = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  function empty(el, text) {
    el.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'sb-empty';
    p.textContent = text;
    el.appendChild(p);
  }

  /* ── ① Notion page list ── */
  async function refreshNotion() {
    if (!hasBackend) { empty(notionItems, '서버 연결 후 사용할 수 있어요.'); return; }
    if (notionRefreshBtn) notionRefreshBtn.classList.add('spin');
    try {
      const r = await fetch('api/notion?op=list');
      if (r.status === 501) {
        empty(notionItems, '노션 연동 대기 — 넷리파이에 NOTION_API_KEY 설정이 필요해요.');
        return;
      }
      if (!r.ok) throw new Error('list_' + r.status);
      const pages = (await r.json()).pages || [];
      if (!pages.length) {
        empty(notionItems, '아직 페이지가 없어요. 조커에게 "노션에 저장해줘"라고 해보세요.');
        return;
      }
      notionItems.innerHTML = '';
      for (const p of pages.slice(0, 12)) {
        const row = document.createElement('div');
        row.className = 'notion-item';
        const body = document.createElement('a');
        body.className = 'body';
        body.href = p.url || '#';
        body.target = '_blank';
        body.rel = 'noopener';
        body.title = '노션에서 열기';
        const t = document.createElement('b');
        t.textContent = p.title || '(제목 없음)';
        body.appendChild(t);
        if (p.edited) {
          const when = document.createElement('span');
          try { when.textContent = SHORT_FMT.format(new Date(p.edited)); } catch {}
          body.appendChild(when);
        }
        row.appendChild(body);

        /* default actions: 💬 read / 🗑 delete(→ inline confirm) */
        const acts = document.createElement('div');
        acts.className = 'acts';
        const ask = document.createElement('button');
        ask.className = 'ask';
        ask.textContent = '💬';
        ask.title = '조커가 이 페이지를 읽어옵니다';
        ask.addEventListener('click', () => {
          if (window.JokerChat && window.JokerChat.send) {
            window.JokerChat.send('"' + (p.title || '') + '" 페이지(노션ID: ' + p.id + ') 읽어줘.');
          }
        });
        const del = document.createElement('button');
        del.className = 'ask del-ico';
        /* 🗑 이모지는 다크 테마에서 잘 안 보여서 선 아이콘 사용 */
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        del.title = '노션 휴지통으로 보내기 (복구 가능)';
        del.addEventListener('click', () => row.classList.add('confirming'));
        acts.append(ask, del);
        row.appendChild(acts);

        /* inline confirm — the ONLY path that actually archives, one page at a time */
        const confirm = document.createElement('div');
        confirm.className = 'confirm';
        const ok = document.createElement('button');
        ok.className = 'ok';
        ok.textContent = '삭제';
        const cancel = document.createElement('button');
        cancel.textContent = '취소';
        cancel.addEventListener('click', () => row.classList.remove('confirming'));
        ok.addEventListener('click', async () => {
          if (ok.dataset.busy) return;
          ok.dataset.busy = '1';
          ok.textContent = '…';
          try {
            const rr = await fetch('api/notion', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ op: 'archive', page_id: p.id }),
            });
            if (!rr.ok) throw new Error('archive_' + rr.status);
            row.remove();
            if (!notionItems.querySelector('.notion-item')) refreshNotion();
          } catch (err) {
            console.warn('[joker sidebar] archive:', err);
            ok.textContent = '실패';
            setTimeout(() => {
              ok.textContent = '삭제';
              delete ok.dataset.busy;
              row.classList.remove('confirming');
            }, 1500);
          }
        });
        confirm.append(ok, cancel);
        row.appendChild(confirm);

        notionItems.appendChild(row);
      }
    } catch (err) {
      console.warn('[joker sidebar] notion:', err);
      if (!notionItems.querySelector('.notion-item')) {
        empty(notionItems, '목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      if (notionRefreshBtn) notionRefreshBtn.classList.remove('spin');
    }
  }

  /* ── 할 일 체크리스트 ── */
  async function todoOp(op, id) {
    try {
      await fetch('api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id !== undefined ? { op, id } : { op }),
      });
    } catch (err) {
      console.warn('[joker sidebar] todo op:', err);
    }
  }

  async function refreshTodos() {
    if (!todoItems) return;
    if (!hasBackend) { empty(todoItems, '서버 연결 후 사용할 수 있어요.'); return; }
    try {
      const r = await fetch('api/todos');
      if (r.status === 503) {
        empty(todoItems, 'Supabase에서 setup.sql을 한 번 실행하면 켜져요.');
        return;
      }
      if (!r.ok) throw new Error('todos_' + r.status);
      const todos = (await r.json()).todos || [];
      const openOnes = todos.filter((t) => !t.done);
      const doneOnes = todos.filter((t) => t.done).slice(0, 3);
      if (!openOnes.length && !doneOnes.length) {
        empty(todoItems, '할 일이 없어요. 조커에게 "투두에 ○○ 추가해줘"라고 해보세요.');
        return;
      }
      todoItems.innerHTML = '';
      for (const t of [...openOnes, ...doneOnes]) {
        const row = document.createElement('div');
        row.className = 'sb-todo' + (t.done ? ' done' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = Boolean(t.done);
        cb.title = t.done ? '다시 미완료로' : '완료 처리';
        cb.addEventListener('change', async () => {
          cb.disabled = true;
          await todoOp(cb.checked ? 'done' : 'undone', t.id);
          refreshTodos();
        });
        const title = document.createElement('b');
        title.textContent = t.title;
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '×';
        del.title = '삭제';
        del.addEventListener('click', async () => {
          del.disabled = true;
          await todoOp('delete', t.id);
          refreshTodos();
        });
        row.append(cb, title, del);
        todoItems.appendChild(row);
      }
    } catch (err) {
      console.warn('[joker sidebar] todos:', err);
      if (!todoItems.querySelector('.sb-todo')) {
        empty(todoItems, '목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    }
  }

  if (todoAddBtn && todoAddWrap && todoInput) {
    todoAddBtn.addEventListener('click', () => {
      todoAddWrap.hidden = !todoAddWrap.hidden;
      if (!todoAddWrap.hidden) todoInput.focus();
    });
    todoInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const title = todoInput.value.trim();
      if (!title) return;
      todoInput.value = '';
      try {
        await fetch('api/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'add', title }),
        });
      } catch (err) {
        console.warn('[joker sidebar] todo add:', err);
      }
      refreshTodos();
    });
  }

  /* ── 미니 달력 (사이드바 상주) ── */
  let calView = null; /* {y, m} 1-based */

  /* 기간 일정(end_at)은 시작~끝의 모든 날짜 키로 펼친다 (최대 62일) */
  function dayKeysBetween(startIso, endIso) {
    const keys = [];
    const start = new Date(startIso);
    if (isNaN(start.getTime())) return keys;
    const startKey = KST_DATE.format(start);
    const end = endIso ? new Date(endIso) : null;
    const endKey = end && !isNaN(end.getTime()) ? KST_DATE.format(end) : startKey;
    let [y, m, d] = startKey.split('-').map(Number);
    for (let i = 0; i < 62; i++) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      keys.push(key);
      if (key === endKey) break;
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate();
    }
    return keys;
  }

  function eventsByDay() {
    const map = {};
    for (const e of (window.JokerEvents && window.JokerEvents.list()) || []) {
      if (!e || !e.title || !e.due_at) continue;
      for (const key of dayKeysBetween(e.due_at, e.end_at)) {
        (map[key] = map[key] || []).push(e);
      }
    }
    return map;
  }

  function renderMiniCal() {
    if (!calGrid || !calTitle) return;
    if (!calView) {
      const p = KST_DATE.format(new Date()).split('-').map(Number);
      calView = { y: p[0], m: p[1] };
    }
    const { y, m } = calView;
    calTitle.textContent = y + '.' + String(m).padStart(2, '0');
    const byDay = eventsByDay();
    const today = KST_DATE.format(new Date());
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    calGrid.innerHTML = '';
    for (const w of ['일', '월', '화', '수', '목', '금', '토']) {
      const h = document.createElement('div');
      h.className = 'dow';
      h.textContent = w;
      calGrid.appendChild(h);
    }
    for (let i = 0; i < firstDow; i++) calGrid.appendChild(document.createElement('div'));
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = document.createElement('button');
      cell.className = 'day' + (key === today ? ' today' : '');
      cell.textContent = d;
      const items = byDay[key] || [];
      if (items.length) {
        /* 기간 일정이 걸친 날은 배경 띠로 이어져 보이게 */
        if (items.some((e) => e.end_at)) cell.classList.add('range');
        const dots = document.createElement('span');
        dots.className = 'dots';
        for (const e of items.slice(0, 3)) {
          const dot = document.createElement('i');
          if (e.kind !== 'event') dot.className = 'rm';
          dots.appendChild(dot);
        }
        cell.appendChild(dots);
      }
      cell.title = items.length ? items.map((e) => e.title).join(', ') : '';
      /* 날짜 클릭 → 큰 캘린더를 그 날짜로 열어 상세·삭제까지 */
      cell.addEventListener('click', () => {
        if (window.JokerCalendar) window.JokerCalendar.open(key);
      });
      calGrid.appendChild(cell);
    }
  }

  function shiftCal(delta) {
    if (!calView) return;
    let { y, m } = calView;
    m += delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    calView = { y, m };
    renderMiniCal();
  }

  /* ── ② upcoming events ── */
  function renderEvents() {
    const list = (window.JokerEvents && window.JokerEvents.list()) || [];
    const cutoff = Date.now() - 3600 * 1000; /* keep events from the last hour visible */
    const upcoming = list
      .filter((e) => e && e.title && e.due_at && new Date(e.due_at).getTime() > cutoff)
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
      .slice(0, 6);
    if (!upcoming.length) {
      empty(eventItems, '다가오는 일정이 없어요. 조커에게 "내일 3시에 미팅 잡아줘"라고 해보세요.');
      return;
    }
    eventItems.innerHTML = '';
    for (const e of upcoming) {
      const row = document.createElement('div');
      row.className = 'sb-event';
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = e.kind === 'event' ? '📅' : '⏰';
      const body = document.createElement('div');
      body.className = 'body';
      const t = document.createElement('b');
      t.textContent = e.title;
      const when = document.createElement('span');
      try {
        when.textContent = e.end_at
          ? KST_DATE.format(new Date(e.due_at)).slice(5).replace('-', '/') +
            ' ~ ' + KST_DATE.format(new Date(e.end_at)).slice(5).replace('-', '/')
          : SHORT_FMT.format(new Date(e.due_at));
      } catch {}
      body.append(t, when);
      row.append(ico, body);
      row.addEventListener('click', () => {
        if (window.JokerCalendar) {
          try { window.JokerCalendar.open(KST_DATE.format(new Date(e.due_at))); }
          catch { window.JokerCalendar.open(); }
        }
      });
      eventItems.appendChild(row);
    }
  }

  function open() {
    sidebar.hidden = false;
    requestAnimationFrame(() => sidebar.classList.add('open'));
    document.body.classList.add('sb-open'); /* shifts .app right so chat stays readable */
    if (toggleBtn) toggleBtn.classList.add('hidden');
    try { localStorage.setItem(OPEN_KEY, '1'); } catch {}
    refreshNotion();
    refreshTodos();
    renderMiniCal();
    renderEvents();
    if (!notionTimer) notionTimer = setInterval(refreshNotion, NOTION_REFRESH_MS);
    if (!eventsTimer) {
      eventsTimer = setInterval(() => { renderMiniCal(); renderEvents(); refreshTodos(); }, EVENTS_REFRESH_MS);
    }
    /* 이벤트 캐시가 늦게 채워지는 첫 로드 직후를 위해 한 번 더 */
    setTimeout(() => { renderMiniCal(); renderEvents(); }, 2500);
  }

  function close() {
    sidebar.classList.remove('open');
    setTimeout(() => { sidebar.hidden = true; }, 300);
    document.body.classList.remove('sb-open');
    if (toggleBtn) toggleBtn.classList.remove('hidden');
    try { localStorage.setItem(OPEN_KEY, '0'); } catch {}
    if (notionTimer) { clearInterval(notionTimer); notionTimer = null; }
    if (eventsTimer) { clearInterval(eventsTimer); eventsTimer = null; }
  }

  if (toggleBtn) toggleBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (notionRefreshBtn) notionRefreshBtn.addEventListener('click', refreshNotion);
  if (calOpenBtn) calOpenBtn.addEventListener('click', () => {
    if (window.JokerCalendar) window.JokerCalendar.open();
  });
  if (briefBtn) briefBtn.addEventListener('click', () => {
    if (window.JokerBrief) window.JokerBrief.run(true);
  });
  if (calPrev) calPrev.addEventListener('click', () => shiftCal(-1));
  if (calNext) calNext.addEventListener('click', () => shiftCal(1));

  /* restore last state; first visit → open automatically on wide screens */
  let saved = null;
  try { saved = localStorage.getItem(OPEN_KEY); } catch {}
  if (saved === '1' || (saved === null && window.innerWidth >= 1280)) {
    /* wait a tick so JokerEvents has a chance to hydrate its cache */
    setTimeout(open, 400);
  }

  window.JokerSidebar = { open, close, refreshNotion, renderEvents, refreshTodos, renderMiniCal };
})();
