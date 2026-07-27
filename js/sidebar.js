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
  const notionRefreshBtn = document.getElementById('sbNotionRefresh');
  const notionItems = document.getElementById('sbNotionItems');
  const calOpenBtn = document.getElementById('sbCalOpen');
  const eventItems = document.getElementById('sbEventItems');
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
        del.className = 'ask';
        del.textContent = '🗑';
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
      try { when.textContent = SHORT_FMT.format(new Date(e.due_at)); } catch {}
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
    renderEvents();
    if (!notionTimer) notionTimer = setInterval(refreshNotion, NOTION_REFRESH_MS);
    if (!eventsTimer) eventsTimer = setInterval(renderEvents, EVENTS_REFRESH_MS);
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

  /* restore last state; first visit → open automatically on wide screens */
  let saved = null;
  try { saved = localStorage.getItem(OPEN_KEY); } catch {}
  if (saved === '1' || (saved === null && window.innerWidth >= 1280)) {
    /* wait a tick so JokerEvents has a chance to hydrate its cache */
    setTimeout(open, 400);
  }

  window.JokerSidebar = { open, close, refreshNotion, renderEvents };
})();
