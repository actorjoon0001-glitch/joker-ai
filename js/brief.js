/* 아침 브리핑 — 매일 오전 8시(한국) 이후 그날 처음 열린 세션에서 조커가
   먼저 오늘 일정·밀린 할 일·최근 노션 기록을 모아 브리핑 말풍선을 띄우고
   TTS로 읽어준다. 표시 여부는 localStorage(joker.brief.last)로 하루 1회 제한.
   사이드바 ☀️ 버튼(JokerBrief.run(true))으로 언제든 다시 들을 수 있다.
   토큰 비용 없이 클라이언트에서 데이터만 조합해 만든다. */
(() => {
  'use strict';

  const LAST_KEY = 'joker.brief.last';
  const BRIEF_HOUR = 8; /* KST */

  if (location.protocol === 'file:') return;

  const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
  const KST_TIME = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const todayKey = () => KST_DATE.format(new Date());
  const kstHour = () => Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false })
      .format(new Date())
  );

  async function fetchJson(url) {
    try {
      const r = await fetch(url);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  async function buildBrief() {
    /* ① 오늘 일정 */
    let events = [];
    try {
      if (window.JokerEvents) {
        await window.JokerEvents.refresh();
        const today = todayKey();
        events = (window.JokerEvents.list() || [])
          .filter((e) => e && e.title && e.due_at && KST_DATE.format(new Date(e.due_at)) === today)
          .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
      }
    } catch {}

    /* ② 미완료 할 일 */
    const todosRes = await fetchJson('api/todos');
    const openTodos = ((todosRes && todosRes.todos) || []).filter((t) => t && !t.done);

    /* ③ 최근 24시간 내 수정된 노션 페이지 */
    const notionRes = await fetchJson('api/notion?op=list');
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const freshPages = ((notionRes && notionRes.pages) || [])
      .filter((p) => p && p.edited && new Date(p.edited).getTime() > dayAgo)
      .slice(0, 3);

    const lines = ['좋은 아침입니다 상준님, 조커의 아침 브리핑입니다.'];

    if (events.length) {
      lines.push('');
      lines.push('오늘 일정 ' + events.length + '건입니다.');
      for (const e of events.slice(0, 6)) {
        lines.push('- ' + KST_TIME.format(new Date(e.due_at)) + ' ' + (e.kind === 'event' ? '[일정] ' : '[리마인더] ') + e.title);
      }
    } else {
      lines.push('');
      lines.push('오늘 등록된 일정은 없습니다.');
    }

    if (openTodos.length) {
      lines.push('');
      lines.push('처리 대기 중인 할 일 ' + openTodos.length + '건입니다.');
      for (const t of openTodos.slice(0, 5)) lines.push('- ' + t.title);
      if (openTodos.length > 5) lines.push('…외 ' + (openTodos.length - 5) + '건은 사이드바에서 확인하세요.');
    } else {
      lines.push('');
      lines.push('밀린 할 일은 없습니다. 깔끔하네요.');
    }

    if (freshPages.length) {
      lines.push('');
      lines.push('최근 하루 사이 노션에 업데이트된 문서는 ' + freshPages.map((p) => '"' + p.title + '"').join(', ') + ' 입니다.');
    }

    lines.push('');
    lines.push(
      events.length || openTodos.length
        ? '오늘도 제가 옆에서 챙기겠습니다. 시작해볼까요?'
        : '한가한 하루네요. 뭐든 시키실 일이 생기면 바로 말씀 주세요.'
    );

    return lines.join('\n');
  }

  let running = false;
  async function run(force) {
    if (running) return;
    if (!window.JokerChat || !window.JokerChat.notify) return;
    if (!force) {
      try { if (localStorage.getItem(LAST_KEY) === todayKey()) return; } catch {}
      if (kstHour() < BRIEF_HOUR) return;
    }
    running = true;
    try {
      const text = await buildBrief();
      try { localStorage.setItem(LAST_KEY, todayKey()); } catch {}
      window.JokerChat.notify(text);
    } catch (err) {
      console.warn('[joker brief]', err);
    } finally {
      running = false;
    }
  }

  /* 접속 직후(대화 복원이 끝날 시간을 준 뒤) 1회 시도하고, 페이지를 계속
     열어두는 경우를 위해 5분마다 다시 확인한다(8시가 지나면 그때 발동). */
  setTimeout(() => run(false), 4000);
  setInterval(() => run(false), 5 * 60 * 1000);

  window.JokerBrief = { run };
})();
