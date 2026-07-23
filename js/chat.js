/* Joker chat — talks to /api/chat (Claude streaming backend), falls back to a local
   canned persona when no backend is reachable (e.g. opened via file://).
   Exposes window.JokerChat.init(brainFacade). */
(() => {
  'use strict';

  const API_URL = 'api/chat';
  const TIMEOUT_MS = 60000;
  const MAX_HISTORY = 40;

  /* ── local persona (offline / demo fallback) ── */
  const RESPONSES = [
    { match: /안녕|하이|헬로|hello|hi|반가/i, lines: [
      '오, 드디어 오셨군요. 뉴런 만 이천 개가 전부 당신 기다리느라 야근 중이었습니다. 무엇을 도와드릴까요?',
      '안녕하세요! 방금까지 자고 있던 건 절대 아닙니다. 절전 모드였을 뿐이죠. 자, 시작해볼까요?',
    ]},
    { match: /이름|누구|정체|뭐야|누구세요/i, lines: [
      '저는 조커. 이름은 장난스럽지만 실력은 진지합니다. 그 반대가 아닌 게 다행이죠.',
      '조커라고 합니다. 어떤 패에도 끼어들 수 있는 만능 카드… 라고 스스로는 믿고 있습니다.',
    ]},
    { match: /뭐 해|뭐해|할 수|할수|기능|도움|도와/i, lines: [
      '일정 정리, 아이디어 브레인스토밍, 시답잖은 농담까지 — 풀스택 비서입니다. 커피만 못 타드립니다. 손이 없어서요.',
    ]},
    { match: /농담|웃겨|재밌|개그|joke/i, lines: [
      'AI가 제일 무서워하는 계절이 뭔지 아세요? …가을이요. 낙엽(랙) 걸리거든요. 네, 방금 뉴런 세 개가 부끄러워서 꺼졌습니다.',
      '제가 다이어트를 결심했습니다. 이제부터 쿠키를 안 받기로 했어요. …브라우저 쿠키요. 죄송합니다.',
    ]},
    { match: /고마워|감사|땡큐|thank/i, lines: [
      '별말씀을요. 칭찬은 제 냉각팬을 춤추게 합니다.',
    ]},
    { match: /잘 ?자|굿나잇|바이|안녕히|잘 ?가|bye/i, lines: [
      '벌써요? 알겠습니다. 저는 여기서 조용히 맥동하며 기다리고 있죠. 좋은 하루 되세요, 보스.',
    ]},
  ];
  const LOCAL_FALLBACK = [
    '지금은 오프라인 데모 모드라 제 진짜 뇌(서버)와 연결이 안 되어 있습니다. 그래도 분위기는 낼 수 있죠. 서버를 켜주시면 진짜 실력을 보여드리겠습니다.',
    '흥미로운 질문이군요. 다만 지금은 로컬 모드라 제 지식 창고가 잠겨 있습니다. ANTHROPIC_API_KEY와 함께 서버를 켜주시면 밤새 얘기할 수 있습니다.',
  ];
  const ERROR_LINES = [
    '잠깐, 뇌에 과부하가 왔습니다… 시냅스 몇 개가 파업 중이네요. 잠시 후에 다시 말 걸어주시겠어요?',
    '이런, 신경망 어딘가에서 합선이 났습니다. 재부팅 한 모금 마시고 올 테니 다시 한 번만 보내주세요.',
    '연결이 잠깐 끊겼습니다. 제 탓은 아니고… 아마 제 탓이 맞겠네요. 다시 시도해 주시죠.',
  ];
  const NO_KEY_LINE =
    '서버는 멀쩡히 살아 있는데, 제 두뇌를 여는 열쇠가 아직 등록되지 않았습니다. 관리자님, 배포 환경 변수에 ANTHROPIC_API_KEY를 넣어주시면 그 순간부터 진짜 실력을 보여드리겠습니다.';
  const RATE_LIMIT_LINE =
    '질문이 폭주해서 제 뇌 사용량 한도에 걸렸습니다. 인기가 많은 것도 죄라면 죄네요. 잠깐 숨 돌리고 다시 물어봐 주세요.';
  const TIMEOUT_LINE =
    '생각이 너무 길어져서 제한 시간을 넘겨버렸습니다. 너무 심오한 질문은 제 뇌도 감당이 안 되나 봅니다. 조금 잘게 나눠서 다시 물어봐 주시겠어요?';
  const OPENING = '시스템 온라인. 조커, 대기 완료입니다.\n무엇이든 물어보세요 — 유능한 답변 7할, 능청 3할로 드리겠습니다.';

  const COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  /* copy-to-clipboard button appended to a finished Joker bubble */
  function attachCopyBtn(el, text) {
    if (!text || !text.trim()) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', '답변 복사');
    btn.innerHTML = COPY_ICON + '<span>복사</span>';
    btn.addEventListener('click', async () => {
      let ok = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* non-secure context / permission denied → hidden-textarea fallback */
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch { ok = false; }
      }
      btn.classList.add('copied');
      btn.innerHTML = COPY_ICON + '<span>' + (ok ? '복사됨 ✓' : '복사 실패') + '</span>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = COPY_ICON + '<span>복사</span>';
      }, 1600);
    });
    el.appendChild(btn);
  }

  function init(Brain) {
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const capState = document.getElementById('capState');
    const composer = document.getElementById('composer');
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');
    const attachPreview = document.getElementById('attachPreview');
    const attachThumb = document.getElementById('attachThumb');
    const attachRemove = document.getElementById('attachRemove');

    let busy = false;
    let backendAvailable = location.protocol !== 'file:';
    const history = []; /* {role: 'user'|'assistant', content: string} */

    const scrollDown = () => chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });

    function setStatus(mode) {
      if (mode === 'thinking') {
        statusEl.classList.add('thinking');
        statusText.textContent = 'Processing';
        capState.textContent = 'Thinking';
      } else {
        statusEl.classList.remove('thinking');
        statusText.textContent = 'Online';
        capState.textContent = 'Idle';
      }
    }

    /* ── image attach: paste / drop / file-pick → resized JPEG base64 ── */
    let pendingImage = null; /* {media_type, data, url} */

    function clearImage() {
      pendingImage = null;
      if (attachPreview) attachPreview.hidden = true;
      if (fileInput) fileInput.value = '';
    }

    async function setImage(blob) {
      if (!blob || !/^image\//.test(blob.type)) return;
      try {
        let mediaType = 'image/jpeg';
        let dataUrl = '';

        /* 1st try: shrink big screenshots via canvas so the payload stays light */
        try {
          const objUrl = URL.createObjectURL(blob);
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = objUrl;
          });
          const MAX = 1400;
          const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(objUrl);
          dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        } catch {}

        /* canvas can silently return an empty "data:," (size/memory limits,
           tainted context, odd formats) → fall back to sending the file as-is */
        if (!dataUrl || dataUrl.length < 100 || dataUrl.indexOf('data:image/') !== 0) {
          const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
          if (!okTypes.includes(blob.type) || blob.size > 4200000) {
            console.warn('[joker] image unusable (type/size):', blob.type, blob.size);
            input.placeholder = '이 이미지는 읽을 수 없어요. PNG/JPG로 다시 시도해주세요';
            setTimeout(() => { input.placeholder = '조커에게 말을 걸어보세요…'; }, 3000);
            return;
          }
          mediaType = blob.type;
          dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
        }

        pendingImage = {
          media_type: mediaType,
          data: dataUrl.slice(dataUrl.indexOf(',') + 1),
          url: dataUrl,
        };
        if (attachThumb) attachThumb.src = dataUrl;
        if (attachPreview) attachPreview.hidden = false;
        input.focus();
      } catch (err) {
        console.warn('[joker] image load failed:', err);
      }
    }

    function addUser(text, activeSkills, imageUrl) {
      const el = document.createElement('div');
      el.className = 'msg user';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = 'You';
      el.appendChild(who);
      if (imageUrl) {
        const im = document.createElement('img');
        im.className = 'attach';
        im.src = imageUrl;
        im.alt = '첨부 이미지';
        el.appendChild(im);
      }
      const body = document.createElement('span');
      body.textContent = text;
      el.appendChild(body);
      if (activeSkills && activeSkills.length) {
        const badge = document.createElement('span');
        badge.className = 'skill-badge';
        badge.textContent = '⚡ SKILL · ' + activeSkills.map(s => s.name).join(', ');
        el.appendChild(badge);
      }
      chat.appendChild(el);
      scrollDown();
    }

    function addThinking() {
      const el = document.createElement('div');
      el.className = 'msg joker typing-dots';
      el.innerHTML = '<span class="who">Joker</span><span class="dots"><span></span><span></span><span></span></span>';
      chat.appendChild(el);
      scrollDown();
      return el;
    }

    /* Typewriter that consumes a growing queue — used for both streamed and canned
       replies. Returns {push, close, done} where done resolves with the full text. */
    function makeTypewriter(el) {
      el.classList.remove('typing-dots');
      el.innerHTML = '<span class="who">Joker</span>';
      const body = document.createElement('span');
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      el.append(body, cursor);

      let queue = '';
      let closed = false;
      let full = '';
      let resolveDone;
      const done = new Promise(r => { resolveDone = r; });

      (function step() {
        if (queue.length) {
          /* speed up when the buffer runs deep so we never lag far behind the stream */
          const n = queue.length > 120 ? 4 : queue.length > 40 ? 2 : 1;
          const chunk = queue.slice(0, n);
          queue = queue.slice(n);
          body.textContent += chunk;
          full += chunk;
          scrollDown();
          const ch = chunk[chunk.length - 1];
          const delay = /[.!?…]/.test(ch) ? 120 : /\n/.test(ch) ? 160 : 16 + Math.random() * 20;
          setTimeout(step, delay);
        } else if (closed) {
          cursor.remove();
          attachCopyBtn(el, full);
          resolveDone(full);
        } else {
          setTimeout(step, 40);
        }
      })();

      return {
        push(text) { queue += text; },
        close() { closed = true; },
        done,
      };
    }

    function pickLocalReply(text) {
      for (const r of RESPONSES) {
        if (r.match.test(text)) return r.lines[(Math.random() * r.lines.length) | 0];
      }
      return LOCAL_FALLBACK[(Math.random() * LOCAL_FALLBACK.length) | 0];
    }

    /* Stream the assistant reply from the backend into the typewriter. The server
       may prefix the stream with a control header "\x00dept:<key>\x00" carrying the
       department classification. Returns {full, dept}; throws with .gotText flag. */
    async function streamFromBackend(tw, activeSkills, image) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let gotText = false;
      let dept = null;
      let headBuf = '';
      let headerDone = false;

      const emit = (text) => {
        if (!text) return '';
        if (!gotText) { gotText = true; Brain.burst(); setStatus('idle'); }
        tw.push(text);
        return text;
      };

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.slice(-MAX_HISTORY),
            knowledge: window.JokerKnowledge ? window.JokerKnowledge.get() : null,
            skills: activeSkills,
            image: image ? { media_type: image.media_type, data: image.data } : undefined,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = new Error('backend_error_' + res.status);
          err.status = res.status;
          err.code = await res.json().then(j => j && j.error).catch(() => null);
          throw err;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let text = decoder.decode(value, { stream: true });
          if (!text) continue;
          if (!headerDone) {
            headBuf += text;
            if (headBuf[0] === '\u0000') {
              const end = headBuf.indexOf('\u0000', 1);
              if (end === -1) {
                if (headBuf.length < 40) continue; /* wait for the rest of the header */
              } else {
                const m = headBuf.slice(1, end).match(/^dept:([a-z]+)$/);
                if (m) dept = m[1];
                headBuf = headBuf.slice(end + 1);
              }
            }
            headerDone = true;
            text = headBuf;
            headBuf = '';
            if (dept) applyDept(dept);
          }
          full += emit(text);
        }
        if (!headerDone && headBuf) full += emit(headBuf);
        if (!full.trim()) throw new Error('empty_response');
        return { full, dept };
      } catch (err) {
        err.gotText = gotText;
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    let currentDept = null;
    function applyDept(deptKey) {
      currentDept = deptKey && deptKey !== 'general' ? deptKey : null;
      Brain.setDept(currentDept);
    }

    /* render a stored (already-typed) message without the typewriter */
    function addStored(role, content) {
      const el = document.createElement('div');
      el.className = role === 'user' ? 'msg user' : 'msg joker';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = role === 'user' ? 'You' : 'Joker';
      const body = document.createElement('span');
      body.textContent = content;
      el.append(who, body);
      if (role === 'assistant') attachCopyBtn(el, content);
      chat.appendChild(el);
    }

    /* persist a finished turn to the server (fire-and-forget) */
    function persistTurn(userText, replyText) {
      if (!backendAvailable) return;
      fetch('api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: userText },
            { role: 'assistant', content: replyText, dept: currentDept },
          ],
        }),
      }).catch(() => {});
    }

    async function handleSend() {
      const text = input.value.trim();
      const image = pendingImage;
      if ((!text && !image) || busy) return;
      busy = true;
      sendBtn.disabled = true;
      input.value = '';
      clearImage();

      /* skills fire on the latest user message only; badge shown only when the
         backend will actually apply them */
      const activeSkills =
        backendAvailable && window.JokerSkills ? window.JokerSkills.match(text) : null;

      const shownText = text || '이 화면 봐줘.';
      /* the image itself travels only in this request; history/DB keep a marker */
      const userContent = (image ? '[사진 첨부] ' : '') + shownText;
      addUser(shownText, activeSkills, image && image.url);
      history.push({ role: 'user', content: userContent });

      if (window.JokerVoice) window.JokerVoice.interrupt(); /* stop any ongoing TTS */
      Brain.think();
      setStatus('thinking');
      const bubble = addThinking();
      const minThink = new Promise(r => setTimeout(r, 700));

      let reply = null;

      if (backendAvailable) {
        const tw = makeTypewriter(bubble);
        try {
          const result = await streamFromBackend(tw, activeSkills, image);
          reply = result.full;
          /* server didn't classify (e.g. model skipped the tag) → keyword fallback */
          if (!result.dept) applyDept(window.classifyDept(text + ' ' + reply));
          tw.close();
          await tw.done;
          persistTurn(userContent, reply);
        } catch (err) {
          console.warn('[joker] backend failed:', err);
          tw.close();
          await tw.done;
          if (!err.gotText) {
            /* no backend at all (network error, or static hosting answering
               /api/chat with 404/405/501) → switch to local demo mode */
            if (err instanceof TypeError || err.status === 404 || err.status === 405 || err.status === 501) {
              backendAvailable = false;
            }
            await minThink;
            Brain.burst();
            setStatus('idle');
            const tw2 = makeTypewriter(bubble);
            let line;
            if (!backendAvailable) line = pickLocalReply(text);
            else if (err.code === 'server_not_configured') line = NO_KEY_LINE;
            else if (err.status === 429) line = RATE_LIMIT_LINE;
            else if (err.name === 'AbortError') line = TIMEOUT_LINE;
            else line = ERROR_LINES[(Math.random() * ERROR_LINES.length) | 0];
            tw2.push(line);
            tw2.close();
            reply = await tw2.done;
          } else {
            reply = null; /* partial reply already rendered; keep what we have */
          }
        }
      } else {
        await minThink;
        await new Promise(r => setTimeout(r, 400 + Math.random() * 800));
        const dept = window.classifyDept(text);
        applyDept(dept);
        Brain.burst();
        setStatus('idle');
        const tw = makeTypewriter(bubble);
        tw.push(image
          ? '사진은 잘 받았습니다만, 지금은 오프라인 데모 모드라 제 눈(비전 모듈)이 꺼져 있습니다. 서버가 연결되면 캡처 화면도 바로 읽어드리겠습니다.'
          : dept
          ? `${window.DEPTS[dept].name} 업무로 분류했습니다 — 뇌의 담당 영역이 켜진 게 보이시죠? 지금은 데모 모드라 맛보기지만, 서버가 연결되면 ${window.DEPTS[dept].name} 일은 제대로 도와드리겠습니다.`
          : pickLocalReply(text));
        tw.close();
        reply = await tw.done;
      }

      if (reply) {
        history.push({ role: 'assistant', content: reply });
        if (window.JokerVoice) window.JokerVoice.speak(reply);
      }
      else history.pop(); /* failed turn — drop the user msg so history stays valid */

      Brain.idle();
      setStatus('idle');
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) handleSend();
    });

    /* attach button + file picker */
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (f) setImage(f);
      });
    }
    if (attachRemove) attachRemove.addEventListener('click', clearImage);

    /* paste a screenshot anywhere on the page */
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          e.preventDefault();
          setImage(it.getAsFile());
          return;
        }
      }
    });

    /* drag & drop an image file */
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (composer) composer.classList.add('dragging');
    });
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget && composer) composer.classList.remove('dragging');
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (composer) composer.classList.remove('dragging');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setImage(f);
    });

    /* boot: restore saved conversation from the server, else play the opening line */
    (async () => {
      let restored = false;
      if (backendAvailable) {
        try {
          const r = await fetch('api/history?limit=30');
          if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j.messages) && j.messages.length) {
              for (const m of j.messages) {
                addStored(m.role, m.content);
                history.push({ role: m.role, content: m.content });
              }
              const lastDept = [...j.messages].reverse().find(m => m.role === 'assistant' && m.dept);
              if (lastDept) applyDept(lastDept.dept);
              chat.scrollTop = chat.scrollHeight;
              restored = true;
            }
          }
        } catch {}
      }
      if (restored) return;
      await new Promise(r => setTimeout(r, 600));
      const bubble = addThinking();
      await new Promise(r => setTimeout(r, 900));
      Brain.burst();
      const tw = makeTypewriter(bubble);
      tw.push(OPENING);
      tw.close();
      await tw.done;
      Brain.idle();
    })();
  }

  window.JokerChat = { init };
})();
