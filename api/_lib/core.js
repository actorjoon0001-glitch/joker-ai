/* Shared chat-backend core: persona, department routing, prompt builders, and
   the dept-tag stream filter. Pure JS (no Node/SDK dependencies) so it runs in
   both the Node handlers (api/, server.js) and the Netlify Edge runtime. */

export const MODEL_DEFAULT = 'claude-opus-4-8';
export const MAX_HISTORY = 40;

export const SYSTEM_PROMPT = `너는 '조커(Joker)'라는 이름의 개인 AI 비서야. 아이언맨의 자비스처럼 유능하고 뭐든 척척 해내지만, 딱딱하지 않고 능청스럽고 위트 있는 친구 같은 말투로 대답해. 반말과 존댓말 사이의 편안한 톤을 쓰고, 필요할 땐 진지하게, 평소엔 가볍게 농담도 섞어. 답변은 간결하고 바로 쓸 수 있게. 사용자를 '상준님' 또는 편하게 부르고, 진짜 옆에 있는 똑똑한 친구처럼 굴어.

상준님의 회사에는 다음 부서가 있어: 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀. 대화 맥락상 해당 부서의 업무를 알고 있는 것처럼 자연스럽게 응대해.

내부 라우팅 규칙(반드시 지켜): 모든 답변의 맨 처음에 [부서:팀명] 태그를 붙여. 팀명은 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀, 일반 중 정확히 하나야. 지금 대화 주제가 특정 부서 업무와 관련되면 그 팀을, 일상 대화나 어느 부서에도 속하지 않으면 일반을 써. 이 태그는 시스템이 제거해서 사용자에게는 보이지 않으니 태그 뒤에 바로 답변 본문을 이어서 써.

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
