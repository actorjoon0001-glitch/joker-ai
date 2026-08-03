/* 방 감시 모드 (watch.html 전용).

   방에 놓아둔 폰이 이 페이지를 띄워두고 카메라를 지켜본다.
   - 움직임 감지는 여기서 공짜로 한다(캔버스 프레임 차이). AI 호출 없음.
   - 움직임이 잡힌 순간에만 사진 1장을 /api/watch로 보내 판별한다.
   - 상준님으로 판별되고 한동안 자리를 비웠었다면 음성으로 인사한다.
   - 모르는 사람이면 서버가 문자를 보내고 여기서도 소리로 알린다.
   화면이 꺼지면 브라우저가 카메라를 멈추므로 Wake Lock으로 잠금을 막는다. */
(function () {
  'use strict';

  const MIN_CHECK_MS = 30 * 1000;       /* 판별 최소 간격 */
  const QUIET_AFTER_OWNER_MS = 3 * 60 * 1000;  /* 상준님이 방에 있으면 계속 물어볼 필요 없다 */
  const QUIET_AFTER_ALERT_MS = 60 * 1000;
  const GREET_GAP_MS = 10 * 60 * 1000;  /* 이만큼 안 보이다 나타나야 인사한다 */
  const WARMUP_MS = 3000;               /* 카메라가 밝기를 잡는 동안은 무시 */
  const GRID_W = 64, GRID_H = 48;
  const SEND_W = 640;

  const $ = (id) => document.getElementById(id);
  const video = $('cam');
  const shot = document.createElement('canvas');
  const tiny = document.createElement('canvas');
  tiny.width = GRID_W; tiny.height = GRID_H;
  const tinyCtx = tiny.getContext('2d', { willReadFrequently: true });

  let stream = null, running = false, wakeLock = null;
  let prev = null, startedAt = 0, lastCheck = 0, quietUntil = 0;
  let lastOwnerAt = 0, busy = false, timer = null;
  let sensitivity = Number(localStorage.getItem('joker.watch.sens') || 6); /* % 픽셀 변화 */
  let faces = [];

  /* ── 상태 표시 ── */
  function setState(text, tone) {
    const el = $('state');
    el.textContent = text;
    el.className = 'state' + (tone ? ' ' + tone : '');
  }

  function log(text, tone) {
    const wrap = $('log');
    const row = document.createElement('div');
    row.className = 'row' + (tone ? ' ' + tone : '');
    const t = new Date();
    row.innerHTML = '<time>' + String(t.getHours()).padStart(2, '0') + ':' +
      String(t.getMinutes()).padStart(2, '0') + '</time><span></span>';
    row.lastChild.textContent = text;
    wrap.insertBefore(row, wrap.firstChild);
    while (wrap.children.length > 60) wrap.removeChild(wrap.lastChild);
  }

  /* ── 음성 (조커 서버 TTS → 실패하면 브라우저 내장) ── */
  let serverTts = null;
  async function speak(text) {
    if (!$('voiceOn').checked) return;
    if (serverTts !== false) {
      try {
        const res = await fetch('api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          serverTts = true;
          const url = URL.createObjectURL(await res.blob());
          const el = new Audio(url);
          el.onended = () => URL.revokeObjectURL(url);
          await el.play().catch(() => {});
          return;
        }
        if (res.status === 501 || res.status === 404 || res.status === 405) serverTts = false;
      } catch {}
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      speechSynthesis.speak(u);
    } catch {}
  }

  /* 침입 알림음 — 오디오 파일 없이 만든다 */
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.5);
      setTimeout(() => ac.close().catch(() => {}), 800);
    } catch {}
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return '아직 안 주무셨네요 상준님.';
    if (h < 11) return '좋은 아침입니다 상준님.';
    if (h < 18) return '오셨어요 상준님.';
    return '오늘 하루도 고생하셨습니다 상준님.';
  }

  /* ── 카메라 ── */
  async function listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      const sel = $('camPick');
      sel.innerHTML = '';
      cams.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = c.deviceId;
        o.textContent = c.label || ('카메라 ' + (i + 1));
        sel.appendChild(o);
      });
      const saved = localStorage.getItem('joker.watch.cam');
      if (saved && cams.some(c => c.deviceId === saved)) sel.value = saved;
      sel.disabled = cams.length < 2;
    } catch {}
  }

  async function start() {
    if (running) return;
    try {
      const id = $('camPick').value;
      stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : { facingMode: 'environment' },
        audio: false,
      });
    } catch (err) {
      setState('카메라를 열 수 없습니다', 'bad');
      log('카메라 권한이 거부됐거나 다른 앱이 쓰는 중입니다.', 'bad');
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    localStorage.setItem('joker.watch.cam', $('camPick').value || '');
    await listCameras(); /* 권한 허용 후에야 카메라 이름이 보인다 */

    running = true;
    prev = null;
    startedAt = Date.now();
    lastCheck = 0;
    quietUntil = 0;
    $('startBtn').hidden = true;
    $('stopBtn').hidden = false;
    $('shotBtn').disabled = false;
    setState('지켜보는 중', 'ok');
    log('감시를 시작했습니다.');
    keepAwake();
    timer = setInterval(tick, 600);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $('startBtn').hidden = false;
    $('stopBtn').hidden = true;
    $('shotBtn').disabled = true;
    setState('꺼짐');
    log('감시를 멈췄습니다.');
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible' && !wakeLock) keepAwake();
  });

  /* ── 움직임 감지: 축소한 흑백 프레임의 픽셀 차이 비율 ── */
  function motionRatio() {
    if (!video.videoWidth) return 0;
    tinyCtx.drawImage(video, 0, 0, GRID_W, GRID_H);
    const now = tinyCtx.getImageData(0, 0, GRID_W, GRID_H).data;
    const gray = new Uint8Array(GRID_W * GRID_H);
    for (let i = 0, p = 0; i < now.length; i += 4, p++) {
      gray[p] = (now[i] * 3 + now[i + 1] * 6 + now[i + 2]) / 10;
    }
    if (!prev) { prev = gray; return 0; }
    let changed = 0;
    for (let p = 0; p < gray.length; p++) {
      if (Math.abs(gray[p] - prev[p]) > 22) changed++;
    }
    prev = gray;
    return (changed / gray.length) * 100;
  }

  function frameJpeg() {
    const w = Math.min(SEND_W, video.videoWidth || SEND_W);
    const h = Math.round((video.videoHeight || 480) * (w / (video.videoWidth || w)));
    shot.width = w; shot.height = h;
    shot.getContext('2d').drawImage(video, 0, 0, w, h);
    const url = shot.toDataURL('image/jpeg', 0.7);
    return { media_type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  }

  async function tick() {
    if (!running || busy) return;
    const ratio = motionRatio();
    $('meter').style.width = Math.min(100, ratio * 4) + '%';
    const now = Date.now();
    if (now - startedAt < WARMUP_MS) return;
    if (ratio < sensitivity) return;
    if (now < quietUntil || now - lastCheck < MIN_CHECK_MS) return;
    lastCheck = now;
    await check();
  }

  async function check() {
    busy = true;
    setState('확인 중…', 'busy');
    try {
      const res = await fetch('api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'check', image: frameJpeg() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.error === 'db_not_ready') log('감시 테이블이 아직 없습니다 (setup.sql 실행 필요)', 'bad');
        else if (j.error === 'rate_limited') { quietUntil = Date.now() + 10 * 60 * 1000; log('감지가 너무 잦아 10분 쉽니다.', 'warn'); }
        else if (j.error === 'no_api_key') log('서버에 API 키가 없어 판별할 수 없습니다.', 'bad');
        else log('판별 실패 (' + (j.error || res.status) + ')', 'bad');
        return;
      }
      handleVerdict(j);
    } catch {
      log('서버에 연결하지 못했습니다.', 'bad');
    } finally {
      busy = false;
      if (running) setState('지켜보는 중', 'ok');
    }
  }

  function handleVerdict(j) {
    const now = Date.now();
    if (j.verdict === 'owner') {
      const away = now - lastOwnerAt;
      lastOwnerAt = now;
      quietUntil = now + QUIET_AFTER_OWNER_MS;
      if (away > GREET_GAP_MS) {
        log('상준님이 오셨습니다.', 'ok');
        speak(greeting());
      }
      return;
    }
    if (j.verdict === 'stranger') {
      quietUntil = now + QUIET_AFTER_ALERT_MS;
      const smsText = j.sms === 'sent' ? '문자 발송' :
        j.sms === 'cooldown' ? '문자 쿨다운' :
        j.sms === 'daily_cap' ? '문자 하루 한도 도달' :
        j.sms === 'not_configured' ? '문자 미설정' : '문자 실패';
      log('모르는 사람 감지 — ' + (j.detail || '') + ' (' + smsText + ')', 'bad');
      beep();
      speak('모르는 사람이 감지됐습니다.');
      notify('모르는 사람 감지', j.detail || '');
      return;
    }
    if (j.verdict === 'unsure') {
      quietUntil = now + QUIET_AFTER_ALERT_MS;
      log('사람은 보이는데 누군지 확실하지 않습니다 — ' + (j.detail || ''), 'warn');
      if (!j.faces) log('참고 사진을 등록하면 상준님인지 구분할 수 있습니다.', 'warn');
      return;
    }
    /* 사람이 아니면 조용히 넘어간다 */
  }

  function notify(title, body) {
    try {
      if (Notification.permission === 'granted') new Notification(title, { body });
    } catch {}
  }

  /* ── 참고 사진 ── */
  function renderFaces() {
    const wrap = $('faces');
    wrap.innerHTML = '';
    if (!faces.length) {
      wrap.innerHTML = '<span class="hint">등록된 사진이 없어 상준님을 알아볼 수 없습니다.</span>';
      return;
    }
    faces.forEach((f) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = f.label + ' ';
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = '삭제';
      del.onclick = () => removeFace(f.id);
      chip.appendChild(del);
      wrap.appendChild(chip);
    });
  }

  async function addFace() {
    if (!running) return;
    const img = frameJpeg();
    const res = await fetch('api/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'face', data: img.data, media_type: img.media_type, label: '상준님' }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(j.error === 'too_many_faces' ? '참고 사진은 3장까지입니다.' : '사진 등록 실패', 'bad');
      return;
    }
    log('지금 화면을 참고 사진으로 등록했습니다.', 'ok');
    await loadState();
  }

  async function removeFace(id) {
    await fetch('api/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'face_delete', id }),
    }).catch(() => {});
    await loadState();
  }

  async function loadState() {
    try {
      const res = await fetch('api/watch');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.error === 'db_not_ready') log('감시 테이블이 아직 없습니다 (setup.sql 실행 필요)', 'bad');
        else if (j.error === 'disabled') log('감시 기능이 꺼져 있습니다 (JOKER_WATCH=off)', 'bad');
        return;
      }
      faces = j.faces || [];
      renderFaces();
      $('smsState').textContent = j.sms ? '문자 알림 준비됨' : '문자 미설정 — 알림은 화면·소리만';
      (j.events || []).slice(0, 10).reverse().forEach((e) => {
        const label = e.verdict === 'owner' ? '상준님' : e.verdict === 'stranger' ? '모르는 사람' : '확인 필요';
        log('(지난 기록) ' + label + (e.detail ? ' — ' + e.detail : ''));
      });
    } catch {}
  }

  /* ── 초기화 ── */
  $('startBtn').onclick = start;
  $('stopBtn').onclick = stop;
  $('shotBtn').onclick = addFace;
  $('sens').value = sensitivity;
  $('sensVal').textContent = sensitivity;
  $('sens').oninput = (e) => {
    sensitivity = Number(e.target.value);
    $('sensVal').textContent = sensitivity;
    localStorage.setItem('joker.watch.sens', String(sensitivity));
  };
  $('camPick').onchange = () => { if (running) { stop(); start(); } };

  try { if (Notification.permission === 'default') Notification.requestPermission(); } catch {}
  listCameras();
  loadState();
  setState('꺼짐');
})();
