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

export function buildSystem(body) {
  const knowledgeBlock = buildKnowledgeBlock(body && body.knowledge);
  const skillBlock = buildSkillBlock(body && body.skills);
  return SYSTEM_PROMPT + (knowledgeBlock || '') + (skillBlock || '');
}

/* Stream filter: buffers the model's leading [부서:팀명] tag, emits a
   "\u0000dept:<key>\u0000" control header instead, then passes text through.
   feed() per delta; flush() once at end of stream. */
export function createDeptTagFilter(writeText, writeHeader) {
  let buf = '';
  let done = false;
  return {
    feed(delta) {
      if (done) { writeText(delta); return; }
      buf += delta;
      const m = buf.match(/^\s*\[부서\s*:\s*([^\]]{1,20})\]\s*/);
      if (m) {
        done = true;
        writeHeader('\u0000dept:' + (DEPT_KEYS[m[1].trim()] || 'general') + '\u0000');
        const rest = buf.slice(m[0].length);
        if (rest) writeText(rest);
        buf = '';
      } else if (!/^\s*(\[[^\]]*)?$/.test(buf) || buf.length > 60) {
        done = true;
        if (buf) writeText(buf);
        buf = '';
      }
    },
    flush() {
      if (!done && buf) { done = true; writeText(buf); buf = ''; }
    },
  };
}
