/* Reminder engine — polls /api/events (Supabase-backed) and fires due
   reminders as a Joker chat bubble, voice (if TTS is on), and a browser
   notification (if permitted). Exposes window.JokerEvents.{list, refresh,
   ensurePermission}. Silently idle when the backend/table isn't available. */
(() => {
  'use strict';

  const POLL_MS = 60000;
  let cache = [];
  let available = location.protocol !== 'file:';

  async function refresh() {
    if (!available) return;
    try {
      const r = await fetch('api/events');
      if (r.status === 503 || r.status === 404 || r.status === 405 || r.status === 501) {
        available = false; /* table not created yet / static hosting */
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      if (Array.isArray(j.events)) cache = j.events;
    } catch {}
  }

  function markNotified(id) {
    fetch('api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'notified', id }),
    }).catch(() => {});
  }

  function checkDue() {
    const now = Date.now();
    for (const e of cache) {
      if (!e || e.notified) continue;
      const t = new Date(e.due_at).getTime();
      if (isNaN(t) || t > now) continue;
      /* fire only things due within the last 24h (older ones stay silent) */
      e.notified = true;
      if (e.id) markNotified(e.id);
      if (now - t > 24 * 3600 * 1000) continue;
      const msg = (e.kind === 'event' ? '📅 일정 시간입니다 — ' : '⏰ 리마인더 — ') + e.title;
      if (window.JokerChat && window.JokerChat.notify) window.JokerChat.notify(msg);
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('JOKER', { body: msg }); } catch {}
      }
    }
  }

  function ensurePermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch {}
    }
  }

  /* ── 코워크 작업 큐: 완료/실패 결과를 채팅으로 알림 ── */
  let tasksAvailable = location.protocol !== 'file:';

  async function checkTasks() {
    if (!tasksAvailable) return;
    try {
      const r = await fetch('api/tasks');
      if (r.status === 503 || r.status === 404 || r.status === 405 || r.status === 501) {
        tasksAvailable = false;
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      for (const t of j.tasks || []) {
        if (!t || t.notified) continue;
        if (t.status !== 'done' && t.status !== 'failed') continue;
        fetch('api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'notified', id: t.id }),
        }).catch(() => {});
        const msg = t.status === 'done'
          ? '🤝 코워크 작업 완료 — ' + (t.result || t.request)
          : '🤝 코워크 작업 실패 — ' + (t.result || t.request) + ' (다시 접수하거나 코워크에서 직접 확인해주세요)';
        if (window.JokerChat && window.JokerChat.notify) window.JokerChat.notify(msg);
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('JOKER · 코워크', { body: msg.slice(0, 120) }); } catch {}
        }
      }
    } catch {}
  }

  window.JokerEvents = { refresh, list: () => cache, ensurePermission };

  (async () => {
    await refresh();
    /* small delay so the boot history-restore finishes before catch-up fires */
    setTimeout(checkDue, 2500);
    setTimeout(checkTasks, 3500);
    setInterval(async () => { await refresh(); checkDue(); checkTasks(); }, POLL_MS);
    /* also tick between polls so a reminder fires within ~15s of its time */
    setInterval(checkDue, 15000);
  })();
})();
