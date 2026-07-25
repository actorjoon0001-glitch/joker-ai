/* Wake-word listener — hands-free "조커" activation.
   While enabled, a continuous background SpeechRecognition transcribes the
   room but IGNORES everything (TV, chatter) until an utterance matches the
   wake condition (조커/joker variants). Then it dictates into the input and
   auto-sends after a short silence. Visual indicators only — no sounds.
   Exposes window.JokerWake.{pause, resume, match} (match exported for tests). */
(() => {
  'use strict';

  const ENABLED_KEY = 'joker.wake.v1';
  const SENS_KEY = 'joker.wake.sens.v1';
  const SILENCE_SEND_MS = 2200;   /* silence after dictation → send */
  const DICT_TIMEOUT_MS = 9000;   /* woke but nothing said → back to waiting */

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const wakeBtn = document.getElementById('wakeBtn');
  const wakePill = document.getElementById('wakePill');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  if (!wakeBtn || !input) return;
  if (!SR) { wakeBtn.hidden = true; if (wakePill) wakePill.hidden = true; return; }

  let enabled = false;
  let sensitivity = 'normal'; /* 'normal' | 'high' */
  try {
    enabled = localStorage.getItem(ENABLED_KEY) === '1';
    sensitivity = localStorage.getItem(SENS_KEY) === 'high' ? 'high' : 'normal';
  } catch {}

  let rec = null;
  let state = 'off';        /* 'off' | 'waiting' | 'dictating' */
  let manualPause = false;  /* while the manual mic button is in use */
  let dictBuffer = '';
  let lastActivity = 0;

  /* wake condition: utterance contains 조커/joker. On 'normal' sensitivity it
     must be near the front or a short call; 'high' matches anywhere. */
  function match(text, sens) {
    const t = String(text).trim().toLowerCase();
    if (!t) return null;
    const i1 = t.indexOf('조커');
    const i2 = t.indexOf('joker');
    const idx = i1 === -1 ? i2 : i2 === -1 ? i1 : Math.min(i1, i2);
    if (idx === -1) return null;
    if ((sens || sensitivity) === 'normal' && idx > 6 && t.length > 14) return null;
    const wordLen = t.startsWith('joker', idx) ? 5 : 2;
    const rest = String(text).trim().slice(idx + wordLen)
      .replace(/^[야아님씨은는이가,.!?~\s]+/, '')
      .trim();
    return { idx, rest };
  }

  function render() {
    wakeBtn.classList.toggle('wake-waiting', state === 'waiting');
    wakeBtn.classList.toggle('wake-live', state === 'dictating');
    wakeBtn.title = state === 'off'
      ? '호출어 대기 꺼짐 — 켜면 "조커야"라고 부르는 것만으로 대화 시작'
      : state === 'waiting'
      ? '호출어 대기 중 ("조커야"라고 불러보세요) — 클릭하면 끔'
      : '듣는 중 — 말을 멈추면 자동 전송';
    if (wakePill) {
      wakePill.hidden = state === 'off';
      wakePill.classList.toggle('live', state === 'dictating');
      wakePill.textContent = state === 'dictating'
        ? '● 듣는 중'
        : '호출 대기 · ' + (sensitivity === 'high' ? '민감' : '보통');
      wakePill.title = '클릭하면 민감도 전환 (보통: 앞부분/짧은 호출만 반응, 민감: 어디서든 반응)';
    }
  }

  function setState(next) {
    state = next;
    if (next !== 'dictating') {
      dictBuffer = '';
      if (input.dataset.wake === '1') {
        input.value = '';
        input.placeholder = '조커에게 말을 걸어보세요…';
        delete input.dataset.wake;
      }
    } else {
      input.dataset.wake = '1';
      input.placeholder = '듣고 있습니다… 말을 멈추면 전송돼요';
      lastActivity = Date.now();
    }
    render();
  }

  function startRec() {
    if (!enabled || manualPause || rec) return;
    const r = new SR();
    rec = r;
    r.lang = 'ko-KR';
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      if (window.__jokerSpeaking) return; /* don't hear Joker's own voice */
      let interim = '';
      const finals = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals.push(t);
        else interim += t;
      }

      if (state === 'waiting') {
        for (const f of finals) {
          const m = match(f);
          if (!m) continue;
          setState('dictating');
          if (m.rest && m.rest.length >= 4) {
            /* "조커야, 오늘 일정 알려줘" — command in the same breath */
            dictBuffer = m.rest;
            input.value = dictBuffer;
            lastActivity = Date.now();
          }
          return;
        }
        return;
      }

      if (state === 'dictating') {
        if (finals.length) {
          dictBuffer = (dictBuffer + ' ' + finals.join(' ')).trim();
          lastActivity = Date.now();
        }
        if (interim.trim()) lastActivity = Date.now();
        input.value = (dictBuffer + ' ' + interim).trim();
      }
    };

    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        disable();
        input.placeholder = '마이크 권한이 없어 호출어 대기를 껐어요';
        setTimeout(() => { input.placeholder = '조커에게 말을 걸어보세요…'; }, 3000);
      }
    };

    r.onend = () => {
      rec = null;
      if (enabled && !manualPause) setTimeout(startRec, 400);
    };

    try { r.start(); if (state === 'off') setState('waiting'); } catch { rec = null; }
  }

  function stopRec() {
    if (rec) {
      const r = rec;
      rec = null;
      try { r.onend = null; r.stop(); } catch {}
    }
  }

  function enable() {
    enabled = true;
    try { localStorage.setItem(ENABLED_KEY, '1'); } catch {}
    setState('waiting');
    startRec();
  }

  function disable() {
    enabled = false;
    try { localStorage.setItem(ENABLED_KEY, '0'); } catch {}
    stopRec();
    setState('off');
  }

  /* silence watcher: send after a pause, or give up if nothing was said */
  setInterval(() => {
    if (state !== 'dictating') return;
    const quiet = Date.now() - lastActivity;
    const text = input.value.trim();
    if (text && quiet > SILENCE_SEND_MS) {
      delete input.dataset.wake;
      input.placeholder = '조커에게 말을 걸어보세요…';
      dictBuffer = '';
      state = 'waiting';
      render();
      sendBtn.click();
    } else if (!text && quiet > DICT_TIMEOUT_MS) {
      setState('waiting');
    }
  }, 400);

  wakeBtn.addEventListener('click', () => (enabled ? disable() : enable()));
  if (wakePill) {
    wakePill.addEventListener('click', () => {
      sensitivity = sensitivity === 'normal' ? 'high' : 'normal';
      try { localStorage.setItem(SENS_KEY, sensitivity); } catch {}
      render();
    });
  }

  window.JokerWake = {
    match,
    pause() { manualPause = true; stopRec(); if (state !== 'off') { state = 'waiting'; render(); } },
    resume() { manualPause = false; if (enabled) startRec(); },
  };

  render();
  if (enabled) startRec();
})();
