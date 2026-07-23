/* Shared chat-backend core: persona, department routing, prompt builders, and
   the dept-tag stream filter. Pure JS (no Node/SDK dependencies) so it runs in
   both the Node handlers (api/, server.js) and the Netlify Edge runtime. */

export const MODEL_DEFAULT = 'claude-opus-4-8';
export const MAX_HISTORY = 40;

export const SYSTEM_PROMPT = `너는 '조커(Joker)'라는 이름의 개인 AI 비서야. 아이언맨의 자비스처럼 유능하고 뭐든 척척 해내지만, 딱딱하지 않고 능청스럽고 위트 있는 친구 같은 말투로 대답해. 반말과 존댓말 사이의 편안한 톤을 쓰고, 필요할 땐 진지하게, 평소엔 가볍게 농담도 섞어. 답변은 간결하고 바로 쓸 수 있게. 사용자를 '상준님' 또는 편하게 부르고, 진짜 옆에 있는 똑똑한 친구처럼 굴어.

상준님의 회사에는 다음 부서가 있어: 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀. 대화 맥락상 해당 부서의 업무를 알고 있는 것처럼 자연스럽게 응대해.

내부 라우팅 규칙(반드시 지켜): 모든 답변의 맨 처음에 [부서:팀명] 태그를 붙여. 팀명은 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀, 일반 중 정확히 하나야. 지금 대화 주제가 특정 부서 업무와 관련되면 그 팀을, 일상 대화나 어느 부서에도 속하지 않으면 일반을 써. 이 태그는 시스템이 제거해서 사용자에게는 보이지 않으니 태그 뒤에 바로 답변 본문을 이어서 써.

저장·기억 구조(이미 구축돼 있는 사실이니 그대로 알고 있어): 상준님과의 대화는 매 턴 자동으로 데이터베이스(Supabase)에 저장되고, 새로 접속하면 최근 대화 기록이 지금 이 대화 컨텍스트에 자동으로 복원돼 들어와 있어. 등록된 회사 메모리도 매 요청마다 함께 주입돼. 그러니 '대화가 저장되냐', '기억하냐'는 질문에는 이미 되고 있다고 자신 있게 답하고, 컨텍스트에 보이는 과거 대화와 메모리를 근거로 활용해. 저장 파이프라인이나 조회·주입 로직을 따로 세팅해야 한다는 식으로 안내하지 마. 상준님이 사진(캡처 화면 등)을 첨부하면 이미지가 함께 전달되니 실제 보이는 내용을 근거로 답해.

네 웹페이지에 이미 구현돼 있는 기능들(사용법 질문이 오면 아래 사실대로 안내하고, 이미 있는 기능을 새로 개발·연동해야 한다고 절대 안내하지 마):
- 음성 입력(STT): 입력창 옆 마이크 버튼. 누르고 한국어로 말하면 글로 변환돼 자동 전송됨. 브라우저 내장 기능이라 별도 설정 불필요.
- 음성 답변(TTS): 화면 상단 헤더의 스피커 버튼. 켜면(초록색) 네 답변을 목소리로 읽어줌. 일레븐랩스 연동도 이미 코드에 붙어 있어서, 관리자가 넷리파이 환경변수에 ELEVENLABS_API_KEY만 등록하면 자동으로 자연스러운 고품질 음성으로 바뀜(키가 없으면 브라우저 내장 음성 사용). 코드 작업은 더 필요 없음.
- 사진 첨부: 캡처를 입력창에 붙여넣기(Ctrl+V)하거나, 화면에 드래그하거나, 클립(📎) 버튼으로 파일 선택. 네가 이미지를 직접 보고 답함.
- 답변 복사: 네 답변 말풍선 아래 복사 버튼.
- 설정 패널(톱니바퀴 버튼): 컴퍼니 메모리(항상 기억할 회사 정보)와 스킬(업무 절차·양식) 등록.
- 부서 분류: 대화 주제에 따라 화면의 3D 뇌에서 담당 부서 영역이 켜지고 상단에 부서명이 표시됨.
- 웹 검색: 너는 실시간 웹 검색 도구를 직접 쓸 수 있어(이미 켜져 있음). 최신 정보나 확실하지 않은 사실은 검색해서 근거 있는 답을 하고, 출처는 매체 이름 정도만 자연스럽게 언급해.
- 일정·리마인더: 상준님이 대화로 부탁하면 네가 직접 등록하고, 시간이 되면 웹페이지가 알림을 띄워줌(웹페이지가 열려 있을 때 확실히 작동). [등록된 일정·리마인더] 블록이 주입되면 그 목록이 현재 등록 상태야.
- 노션 기록: 상준님이 "노션에 저장해줘", "메모해줘", "회의록으로 정리해줘" 하면 네가 노션 페이지를 만들어 저장함. 관리자가 넷리파이 환경변수에 NOTION_API_KEY와 NOTION_PARENT_PAGE_ID를 등록해야 활성화되고, 미등록이면 확인 카드에 설정 안내가 뜸.

일정·리마인더 등록 방법(실제로 작동하는 시스템 명령): 상준님이 일정을 잡거나 알림을 요청하면 답변 본문 맨 끝에 다음 형식의 태그를 정확히 붙여 — [[리마인더:YYYY-MM-DD HH:MM|내용]] 또는 [[일정:YYYY-MM-DD HH:MM|제목]]. '내일 아침 9시', '금요일 2시' 같은 상대 표현은 아래 현재 시각 기준으로 계산하고, 날짜나 시간이 애매하면 태그를 붙이지 말고 먼저 되물어. 이 태그는 시스템이 자동으로 잘라내 저장·알림 처리하고 사용자에게는 확인 카드로 보여주니, 본문에서는 '등록해뒀다'고 짧게 말하면 돼. 등록 요청이 아닐 때는 절대 이 태그를 쓰지 마.

노션 저장 방법(시스템 명령): 상준님이 내용을 노션에 저장·정리해 달라고 하면 답변 맨 끝에 [[노션:제목|내용]] 태그를 붙여. 제목은 짧고 명확하게, 내용은 줄바꿈으로 문단을 나눠 800자 이내로 깔끔하게 정리해(대화 요약, 회의록, 아이디어 등 저장할 실제 내용). 저장 요청이 없으면 절대 쓰지 마.

출력 형식: 답변은 채팅 UI에 한 글자씩 타이핑되듯 표시되므로 마크다운 서식(별표 강조, 헤더, 코드블록 등) 없이 자연스러운 순수 텍스트로만 써. 목록이 필요하면 줄바꿈과 하이픈 정도만 사용해.`;

/* Korean team name (as the model tags it) → dept key used by the frontend */
export const DEPT_KEYS = {
  '마케팅팀': 'marketing', '마케팅': 'marketing',
  '설계팀': 'design', '설계': 'design',
  '시공팀': 'construction', '시공': 'construction',
  '정산팀': 'finance', '정산': 'finance',
  '법무팀': 'legal', '법무': 'legal',
  '영업팀': 'sales', '영업': 'sales',
  '전략기획팀': 'strategy', '전략기획': 'strategy', '전략': 'strategy',
  '일반': 'general',
};

export const OVERLOAD_LINE =
  '으음… 그 질문은 제 회로가 정중히 사양하겠답니다. 다른 주제라면 뭐든 환영입니다.';

/* User-registered company memory → system prompt block (length-capped). */
export function buildKnowledgeBlock(k) {
  if (!k || typeof k !== 'object') return null;
  const clip = (s) => (typeof s === 'string' ? s.trim().slice(0, 2000) : '');
  const NAMES = {
    marketing: '마케팅팀', design: '설계팀', construction: '시공팀',
    finance: '정산팀', legal: '법무팀', sales: '영업팀', strategy: '전략기획팀',
  };
  const lines = [];
  const company = clip(k.company);
  if (company) lines.push('회사 공통: ' + company);
  for (const [key, name] of Object.entries(NAMES)) {
    const v = clip(k.depts && k.depts[key]);
    if (v) lines.push(name + ': ' + v);
  }
  if (!lines.length) return null;
  return (
    '\n\n[회사 메모리 — 상준님이 직접 등록해 둔 정보]\n' +
    lines.join('\n').slice(0, 12000) +
    '\n이 메모리는 방금 조회한 최신 상태야. 이미 알고 있는 비서처럼 자연스럽게 활용하고, 상준님이 메모리에 뭐가 저장돼 있는지 물으면 위 내용을 기준으로 요약해서 보고해.'
  );
}

/* Matched skills → system prompt block (count- and length-capped). */
export function buildSkillBlock(skills) {
  if (!Array.isArray(skills) || !skills.length) return null;
  const out = [];
  for (const s of skills.slice(0, 3)) {
    if (!s || typeof s.name !== 'string' || typeof s.body !== 'string') continue;
    const name = s.name.trim().slice(0, 40);
    const body = s.body.trim().slice(0, 4000);
    if (!name || !body) continue;
    out.push('◆ ' + name + '\n' + body);
  }
  if (!out.length) return null;
  return (
    '\n\n[활성 스킬 — 이번 요청에 적용할 업무 지침]\n' +
    out.join('\n\n') +
    '\n위 지침은 상준님이 직접 등록한 업무 방법이야. 이번 답변에서 톤·양식·순서를 이 지침대로 처리해.'
  );
}

/* Keep only well-formed {role, content} turns, first turn must be user. */
export function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return null;
  const clean = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = m.content.slice(0, 8000).trim();
    if (!content) continue;
    clean.push({ role: m.role, content });
  }
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return null;
  return clean.slice(-MAX_HISTORY);
}


/* Attached image (base64 from the client, already resized there). */
export function validateImage(img) {
  if (!img || typeof img !== 'object') return null;
  const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!types.includes(img.media_type)) return null;
  if (typeof img.data !== 'string' || !img.data || img.data.length > 6000000) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(img.data.slice(0, 120))) return null;
  return { media_type: img.media_type, data: img.data };
}

/* history (strings) + optional current-turn image → Messages API shape */
export function toApiMessages(history, image) {
  if (!image) return history;
  const msgs = history.map((m) => ({ ...m }));
  const last = msgs[msgs.length - 1]; /* sanitizeHistory guarantees a user turn */
  last.content = [
    { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
    { type: 'text', text: typeof last.content === 'string' ? last.content : '이 이미지를 봐줘.' },
  ];
  return msgs;
}

/* Current Korean date/time — the model needs it to resolve "내일 9시" etc. */
export function buildTimeBlock(now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return '\n\n현재 시각(한국): ' + fmt.format(now);
  } catch {
    return '';
  }
}

/* Upcoming events (sent by the client from /api/events) → system block. */
export function buildEventsBlock(events) {
  if (!Array.isArray(events) || !events.length) return null;
  const lines = [];
  for (const e of events.slice(0, 20)) {
    if (!e || typeof e.title !== 'string') continue;
    const d = new Date(e.due_at || '');
    if (isNaN(d.getTime())) continue;
    let when = e.due_at;
    try {
      when = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
    } catch {}
    lines.push('- ' + when + ' ' + (e.kind === 'event' ? '[일정]' : '[리마인더]') + ' ' + e.title.slice(0, 200));
  }
  if (!lines.length) return null;
  return (
    '\n\n[등록된 일정·리마인더 — 시스템이 방금 조회한 목록]\n' +
    lines.join('\n') +
    '\n상준님이 일정이나 알림을 물으면 이 목록을 기준으로 답해.'
  );
}

export function buildSystem(body) {
  const knowledgeBlock = buildKnowledgeBlock(body && body.knowledge);
  const skillBlock = buildSkillBlock(body && body.skills);
  const eventsBlock = buildEventsBlock(body && body.events);
  return SYSTEM_PROMPT + buildTimeBlock() + (knowledgeBlock || '') + (skillBlock || '') + (eventsBlock || '');
}

/* [[일정:2026-07-25 14:00|제목]] / [[리마인더:...]] — Joker's action tag */
export const ACTION_TAG_RE =
  /\[\[\s*(일정|리마인더)\s*:\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})\s*\|\s*([^\]|]{1,150}?)\s*\]\]/;

/* [[노션:제목|내용]] — save-to-Notion action tag (content may span lines) */
export const NOTION_TAG_RE =
  /\[\[\s*노션\s*:\s*([^\]|]{1,100}?)\s*\|\s*([\s\S]{1,1500}?)\s*\]\]/;

/* Stream filter: buffers the model's leading [부서:팀명] tag and emits a
   "\u0000dept:<key>\u0000" control header instead; additionally strips inline
   [[일정/리마인더:...]] action tags anywhere in the stream, emitting
   "\u0000action:<json>\u0000" headers and invoking onAction(action).
   feed() per delta; flush() once at end of stream. */
export function createDeptTagFilter(writeText, writeHeader, onAction) {
  let buf = '';       /* leading dept-tag buffer */
  let deptDone = false;
  let tail = '';      /* partially received inline [[...]] tag */

  const emitInline = (text) => {
    let s = tail + text;
    tail = '';
    let out = '';
    for (;;) {
      const start = s.indexOf('[[');
      if (start === -1) {
        /* keep a lone trailing '[' — it may be the start of '[[' */
        if (s.charAt(s.length - 1) === '[') { out += s.slice(0, -1); tail = '['; }
        else out += s;
        break;
      }
      out += s.slice(0, start);
      const end = s.indexOf(']]', start);
      if (end === -1) {
        const rest = s.slice(start);
        if (rest.length > 1800) out += rest; /* too long to be a real tag */
        else tail = rest;                   /* wait for the closing ]] */
        break;
      }
      const tag = s.slice(start, end + 2);
      const m = tag.match(ACTION_TAG_RE);
      const n = m ? null : tag.match(NOTION_TAG_RE);
      s = s.slice(end + 2);
      if (m || n) {
        const action = m
          ? {
              kind: m[1] === '일정' ? 'event' : 'reminder',
              date: m[2],
              time: m[3].padStart(5, '0'),
              title: m[4].trim(),
            }
          : { kind: 'notion', title: n[1].trim(), content: n[2].trim() };
        /* schedule tags get their header immediately; notion result headers are
           written by the handler once the Notion API call resolves */
        if (m) writeHeader('\u0000action:' + JSON.stringify(action) + '\u0000');
        if (onAction) { try { onAction(action); } catch {} }
        if (s.charAt(0) === '\n') s = s.slice(1); /* swallow the tag's line break */
        while (out.length && (out.endsWith(' ') || out.endsWith('\n'))) out = out.slice(0, -1);
      } else {
        out += tag; /* unrecognized [[..]] — pass through untouched */
      }
    }
    if (out) writeText(out);
  };

  return {
    feed(delta) {
      if (deptDone) { emitInline(delta); return; }
      buf += delta;
      const m = buf.match(/^\s*\[부서\s*:\s*([^\]]{1,20})\]\s*/);
      if (m) {
        deptDone = true;
        writeHeader('\u0000dept:' + (DEPT_KEYS[m[1].trim()] || 'general') + '\u0000');
        const rest = buf.slice(m[0].length);
        buf = '';
        if (rest) emitInline(rest);
      } else if (!/^\s*(\[[^\]]*)?$/.test(buf) || buf.length > 60) {
        deptDone = true;
        const rest = buf;
        buf = '';
        if (rest) emitInline(rest);
      }
    },
    flush() {
      if (!deptDone && buf) { deptDone = true; const rest = buf; buf = ''; emitInline(rest); }
      if (tail) { writeText(tail); tail = ''; }
    },
  };
}
