/* Voice I/O — mic button (Web Speech API speech-to-text, ko-KR) that fills the
   input and auto-sends, plus a header toggle that reads Joker's replies aloud.
   Speech output prefers the server's /api/tts (ElevenLabs — natural voice,
   active once ELEVENLABS_API_KEY is deployed) and falls back to the browser's
   built-in speechSynthesis when the server answers 501/404.
   Exposes window.JokerVoice.{speak, interrupt}. */
(() => {
  'use strict';

  const TTS_KEY = 'joker.tts.v1';
  const micBtn = document.getElementById('micBtn');
  const ttsBtn = document.getElementById('ttsBtn');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');

  /* ── speech output (TTS) ── */
  const synth = window.speechSynthesis || null;
  let ttsOn = false;
  try { ttsOn = localStorage.getItem(TTS_KEY) === '1'; } catch {}

  let serverTts = location.protocol === 'file:' ? false : null; /* null = not probed yet */
  let audioEl = null;

  function stopAudio() {
    if (audioEl) {
      try { audioEl.pause(); } catch {}
      audioEl = null;
    }
  }

  function pickKoreanVoice() {
    if (!synth) return null;
    const voices = synth.getVoices();
    return voices.find(v => /ko[-_]KR/i.test(v.lang)) || voices.find(v => /^ko/i.test(v.lang)) || null;
  }

  function speakLocal(clean) {
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'ko-KR';
    const voice = pickKoreanVoice();
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.pitch = 1.0;
    synth.speak(u);
  }

  async function speak(text) {
    if (!ttsOn || !text) return;
    /* strip the blinking-cursor artifacts / trim long pauses */
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    stopAudio();
    if (synth) synth.cancel();

    if (serverTts !== false) {
      try {
        const res = await fetch('api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean }),
        });
        if (res.ok) {
          serverTts = true;
          const url = URL.createObjectURL(await res.blob());
          const el = new Audio(url);
          audioEl = el;
          el.onended = () => { URL.revokeObjectURL(url); if (audioEl === el) audioEl = null; };
          await el.play().catch(() => {});
          return;
        }
        /* this deploy has no server TTS → remember and stop asking */
        if (res.status === 501 || res.status === 404 || res.status === 405) serverTts = false;
      } catch { /* network hiccup — fall back just for this reply */ }
    }
    speakLocal(clean);
  }

  function interrupt() {
    stopAudio();
    if (synth) synth.cancel();
    stopListening();
  }

  function renderTts() {
    if (!ttsBtn) return;
    ttsBtn.classList.toggle('active', ttsOn);
    ttsBtn.title = ttsOn ? '음성 답변 켜짐 (클릭해서 끄기)' : '음성 답변 꺼짐 (클릭해서 켜기)';
  }

  if (ttsBtn) {
    if (!synth && serverTts === false) {
      ttsBtn.hidden = true; /* file:// with no browser voice — nothing can speak */
    } else {
      renderTts();
      ttsBtn.addEventListener('click', () => {
        ttsOn = !ttsOn;
        try { localStorage.setItem(TTS_KEY, ttsOn ? '1' : '0'); } catch {}
        renderTts();
        if (!ttsOn) {
          stopAudio();
          if (synth) synth.cancel();
        } else {
          speak('음성 답변을 켰습니다. 이제 답변을 읽어드릴게요.');
        }
      });
    }
  }

  /* ── speech input (STT) ── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let rec = null;
  let listening = false;

  function stopListening() {
    if (rec && listening) {
      try { rec.stop(); } catch {}
    }
  }

  if (micBtn) {
    if (!SR) {
      micBtn.hidden = true; /* e.g. Firefox / some in-app browsers */
    } else {
      micBtn.addEventListener('click', () => {
        if (listening) { stopListening(); return; }
        if (synth) synth.cancel();

        rec = new SR();
        rec.lang = 'ko-KR';
        rec.interimResults = true;
        rec.continuous = false;

        let finalText = '';
        listening = true;
        micBtn.classList.add('listening');
        input.placeholder = '듣고 있습니다… 말씀하세요';

        rec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalText += t;
            else interim += t;
          }
          input.value = (finalText + interim).trim();
        };

        rec.onerror = (e) => {
          console.warn('[joker voice]', e.error);
          if (e.error === 'not-allowed') {
            input.placeholder = '마이크 권한을 허용해주세요';
            setTimeout(() => { input.placeholder = '조커에게 말을 걸어보세요…'; }, 2500);
          }
        };

        rec.onend = () => {
          listening = false;
          micBtn.classList.remove('listening');
          input.placeholder = '조커에게 말을 걸어보세요…';
          const text = input.value.trim();
          if (text && finalText.trim()) sendBtn.click(); /* auto-send what was heard */
        };

        try { rec.start(); } catch (err) { console.warn('[joker voice]', err); listening = false; micBtn.classList.remove('listening'); }
      });
    }
  }

  /* warm the voice list (some browsers populate it async) */
  if (synth) synth.getVoices();

  window.JokerVoice = { speak, interrupt };
})();
