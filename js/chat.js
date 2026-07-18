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

  function init(Brain) {
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const capState = document.getElementById('capState');

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

    function addUser(text) {
      const el = document.createElement('div');
      el.className = 'msg user';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = 'You';
      const body = document.createElement('span');
      body.textContent = text;
      el.append(who, body);
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

    /* Stream the assistant reply from the backend into the typewriter.
       Returns the full reply text; throws on failure with .gotText flag. */
    async function streamFromBackend(tw) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let gotText = false;
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
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
          const text = decoder.decode(value, { stream: true });
          if (text) {
            if (!gotText) { gotText = true; Brain.burst(); setStatus('idle'); }
            full += text;
            tw.push(text);
          }
        }
        if (!full.trim()) throw new Error('empty_response');
        return full;
      } catch (err) {
        err.gotText = gotText;
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    async function handleSend() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      sendBtn.disabled = true;
      input.value = '';

      addUser(text);
      history.push({ role: 'user', content: text });

      Brain.think();
      setStatus('thinking');
      const bubble = addThinking();
      const minThink = new Promise(r => setTimeout(r, 700));

      let reply = null;

      if (backendAvailable) {
        const tw = makeTypewriter(bubble);
        try {
          reply = await streamFromBackend(tw);
          tw.close();
          await tw.done;
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
        Brain.burst();
        setStatus('idle');
        const tw = makeTypewriter(bubble);
        tw.push(pickLocalReply(text));
        tw.close();
        reply = await tw.done;
      }

      if (reply) history.push({ role: 'assistant', content: reply });
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

    /* opening line (client-side only, not part of API history) */
    setTimeout(async () => {
      const bubble = addThinking();
      await new Promise(r => setTimeout(r, 900));
      Brain.burst();
      const tw = makeTypewriter(bubble);
      tw.push(OPENING);
      tw.close();
      await tw.done;
      Brain.idle();
    }, 600);
  }

  window.JokerChat = { init };
})();
