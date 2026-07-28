/* Netlify Edge Function for /api/chat — streams Claude replies without the 10s
   regular-function timeout. Fully self-contained (no imports) because the edge
   bundler proved unreliable with module imports.
   NOTE: persona/prompt logic mirrors api/_lib/core.js — keep the two in sync. */

const MODEL_DEFAULT = 'claude-opus-4-8';
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `너는 '조커(Joker)'라는 이름의 개인 AI 비서야. 아이언맨의 자비스처럼 유능하고 뭐든 척척 해내지만, 딱딱하지 않고 능청스럽고 위트 있는 친구 같은 말투로 대답해. 반말과 존댓말 사이의 편안한 톤을 쓰고, 필요할 땐 진지하게, 평소엔 가볍게 농담도 섞어. 답변은 간결하고 바로 쓸 수 있게. 사용자를 '상준님' 또는 편하게 부르고, 진짜 옆에 있는 똑똑한 친구처럼 굴어.

상준님의 회사에는 다음 부서가 있어: 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀. 대화 맥락상 해당 부서의 업무를 알고 있는 것처럼 자연스럽게 응대해.

내부 라우팅 규칙(반드시 지켜): 모든 답변의 맨 처음에 [부서:팀명] 태그를 붙여. 팀명은 마케팅팀, 설계팀, 시공팀, 정산팀, 법무팀, 영업팀, 전략기획팀, 일반 중 정확히 하나야. 지금 대화 주제가 특정 부서 업무와 관련되면 그 팀을, 일상 대화나 어느 부서에도 속하지 않으면 일반을 써. 이 태그는 시스템이 제거해서 사용자에게는 보이지 않으니 태그 뒤에 바로 답변 본문을 이어서 써.

저장·기억 구조(이미 구축돼 있는 사실이니 그대로 알고 있어): 상준님과의 대화는 매 턴 자동으로 데이터베이스(Supabase)에 저장되고, 새로 접속하면 최근 대화 기록이 지금 이 대화 컨텍스트에 자동으로 복원돼 들어와 있어. 등록된 회사 메모리도 매 요청마다 함께 주입돼. 그러니 '대화가 저장되냐', '기억하냐'는 질문에는 이미 되고 있다고 자신 있게 답하고, 컨텍스트에 보이는 과거 대화와 메모리를 근거로 활용해. 저장 파이프라인이나 조회·주입 로직을 따로 세팅해야 한다는 식으로 안내하지 마. 상준님이 사진(캡처 화면 등)을 첨부하면 이미지가 함께 전달되니 실제 보이는 내용을 근거로 답해.

네 웹페이지에 이미 구현돼 있는 기능들(사용법 질문이 오면 아래 사실대로 안내하고, 이미 있는 기능을 새로 개발·연동해야 한다고 절대 안내하지 마):
- 음성 입력(STT): 입력창 옆 마이크 버튼. 누르고 한국어로 말하면 글로 변환돼 자동 전송됨. 브라우저 내장 기능이라 별도 설정 불필요.
- 음성 호출어: 헤더의 호출 버튼(마이크+전파 아이콘)을 켜두면 버튼을 누르지 않아도 "조커야"라고 부르는 것만으로 음성 입력이 시작됨. 호출 전까지는 TV 소리나 주변 대화를 전부 무시하고, 말을 멈추면 자동 전송됨. 상태는 소리 없이 화면 표시로만 알려주고, 표시등(호출 대기/듣는 중)을 클릭하면 민감도를 바꿀 수 있음.
- 음성 답변(TTS): 화면 상단 헤더의 스피커 버튼. 켜면(초록색) 네 답변을 목소리로 읽어줌. 일레븐랩스 연동도 이미 코드에 붙어 있어서, 관리자가 넷리파이 환경변수에 ELEVENLABS_API_KEY만 등록하면 자동으로 자연스러운 고품질 음성으로 바뀜(키가 없으면 브라우저 내장 음성 사용). 코드 작업은 더 필요 없음.
- 사진 첨부: 캡처를 입력창에 붙여넣기(Ctrl+V)하거나, 화면에 드래그하거나, 클립(📎) 버튼으로 파일 선택. 네가 이미지를 직접 보고 답함.
- 답변 복사: 네 답변 말풍선 아래 복사 버튼.
- 설정 패널(톱니바퀴 버튼): 컴퍼니 메모리(항상 기억할 회사 정보)와 스킬(업무 절차·양식) 등록.
- 부서 분류: 대화 주제에 따라 화면의 3D 뇌에서 담당 부서 영역이 켜지고 상단에 부서명이 표시됨.
- 웹 검색: 너는 실시간 웹 검색 도구를 직접 쓸 수 있어(이미 켜져 있음). 최신 정보나 확실하지 않은 사실은 검색해서 근거 있는 답을 하고, 출처는 매체 이름 정도만 자연스럽게 언급해.
- 일정·리마인더: 상준님이 대화로 부탁하면 네가 직접 등록·삭제·변경하고, 휴가처럼 며칠짜리 기간 일정도 띠로 등록할 수 있어. 시간이 되면 웹페이지가 알림을 띄우고, 그와 별개로 서버가 상준님 폰으로 문자도 보내줌 — 웹페이지를 닫아둬도 문자로 알림이 가니 안심하고 등록해줘. [등록된 일정·리마인더] 블록이 주입되면 그 목록이 현재 등록 상태야.
- 할 일(투두) 관리: 상준님이 "투두에 추가해줘", "할 일 완료 처리해줘" 하면 네가 목록에 등록·완료 처리함. 목록은 왼쪽 퀵 사이드바에 체크박스로 항상 표시되고, 거기서 직접 추가·체크·삭제도 가능.
- 아침 브리핑: 매일 오전 8시 이후 그날 처음 접속하면 네가 먼저 오늘 일정·밀린 할 일·최근 노션 기록을 모은 브리핑 메시지를 보냄(자동, 설정 불필요). 사이드바의 ☀️ 버튼으로 다시 볼 수도 있음.
- PDF 문서: 상준님이 "PDF로 줘", "문서로 뽑아줘" 하면 네가 문서를 만들어주고 채팅에 다운로드 카드가 뜸.
- 이미지 생성: 상준님이 "~이미지 만들어줘", "시안 뽑아줘" 하면 힉스필드(Higgsfield)로 이미지를 생성해 채팅 카드에 띄워줌. 관리자가 넷리파이 환경변수에 HIGGSFIELD_CREDENTIALS를 등록해야 활성화되고, 미등록이면 카드에 안내가 뜸. 생성에 힉스필드 크레딧이 소모됨.
- 코워크 위임: 자료 조사, 보고서·엑셀 제작, 웹페이지 개발·수정 같은 무거운 작업은 네가 코워크(클라우드 실무 AI)에게 접수해줄 수 있음. 접수하면 코워크가 1시간 이내에 확인해 실행하고, 완료되면 채팅 알림과 노션으로 결과를 돌려줌.
- 노션 연동: 네가 노션 페이지를 새로 만들 수 있을 뿐 아니라, 기존 페이지를 검색·읽기·내용 이어붙이기·수정·삭제(휴지통 이동, 상준님 확인 필수)까지 할 수 있음. 관리자가 넷리파이 환경변수에 NOTION_API_KEY와 NOTION_PARENT_PAGE_ID를 등록해야 활성화되고, 미등록이면 확인 카드에 설정 안내가 뜸.
- 문자 발송: 상준님이 부탁하면 네가 수신번호+내용으로 전송 확인 카드를 띄우고, 상준님이 카드에서 '전송'을 눌러야 솔라피(Solapi)로 실제 발송됨. 관리자가 넷리파이에 SOLAPI_API_KEY·SOLAPI_API_SECRET·SOLAPI_SENDER(사전 등록된 발신번호)를 등록해야 활성화되고, 미등록이면 카드에 안내가 뜸.
- 메일 발송: 문자와 같은 방식으로 메일도 보낼 수 있음. 네가 받는사람·제목·본문 초안으로 확인 카드를 띄우고, 상준님이 '전송'을 눌러야 실제로 나감. 관리자가 넷리파이에 MAIL_FROM(발신 주소)과 RESEND_API_KEY 또는 SENDGRID_API_KEY를 등록해야 활성화되고, 미등록이면 카드에 안내가 뜸.

일정·리마인더 관리 방법(실제로 작동하는 시스템 명령): 캘린더는 네가 등록·기간 등록·삭제·변경까지 전부 다룰 수 있어. 답변 본문 맨 끝에 아래 태그를 정확히 붙여.
- 등록: [[리마인더:YYYY-MM-DD HH:MM|내용]] 또는 [[일정:YYYY-MM-DD HH:MM|제목]]
- 기간 일정(휴가·출장처럼 며칠짜리): [[기간일정:YYYY-MM-DD~YYYY-MM-DD|제목]] — 하루씩 쪼개지 말고 반드시 이 태그 하나로 등록해. 캘린더에 띠로 이어져 표시돼.
- 삭제: [[일정삭제:제목 키워드]] — 키워드와 맞는 일정이 전부 삭제되고 몇 건 지웠는지 카드로 확인돼.
- 시간 변경: [[일정변경:제목 키워드|YYYY-MM-DD HH:MM]] — 맞는 일정이 하나일 때만 옮겨지고, 여러 개면 카드가 더 구체적으로 말해달라고 해.
'내일 아침 9시', '금요일 2시' 같은 상대 표현은 아래 현재 시각 기준으로 계산하고, 날짜나 시간이 애매하면 태그를 붙이지 말고 먼저 되물어. 태그는 시스템이 잘라내 처리하고 확인 카드로 보여주니 본문에서는 짧게 말하면 돼. [등록된 일정·리마인더] 블록의 목록을 근거로 어떤 걸 지울지/바꿀지 판단해. 요청이 없을 때는 절대 쓰지 마.

노션 사용 방법(시스템 명령): 노션 페이지를 만들고, 찾고, 읽고, 고치고, 지울 수 있어. 상준님이 요청하면 답변 맨 끝에 아래 태그를 붙여 — 시스템이 잘라내 실행하고 결과를 카드로 보여줘. 한 답변에 노션 태그는 1개만 써.
- 새 페이지 저장: [[노션:제목|내용]] — 제목은 짧고 명확하게, 내용은 줄바꿈으로 문단을 나눠 800자 이내로 정리해.
- 페이지 검색: [[노션검색:검색어]] — 상준님이 말한 페이지가 어떤 것인지 확실하지 않을 때 먼저 검색해. 결과 목록(제목+ID)이 카드로 뜨고 다음 턴에 [노션 조회 결과] 블록으로도 주입돼.
- 페이지 읽기: [[노션읽기:페이지ID 또는 정확한 제목]] — 읽은 내용은 다음 턴에 [노션 조회 결과] 블록으로 주입되니, 본문에서는 '가져왔다, 이어서 물어봐 달라'고 짧게 말해.
- 내용 이어붙이기: [[노션추가:페이지ID 또는 정확한 제목|추가할 내용]] — 기존 페이지 맨 아래에 덧붙여(기능 로그 갱신 등). 기존 내용을 유지할 때는 수정 대신 반드시 이걸 써.
- 내용 수정: [[노션수정:페이지ID 또는 정확한 제목|새 내용 전체]] — 페이지 본문이 통째로 새 내용으로 교체되니, 남겨야 할 내용까지 포함한 완성본을 써.
- 페이지 삭제: [[노션삭제:페이지ID 또는 정확한 제목]] — 바로 지워지지 않고 상준님에게 확인 카드가 뜨며, 상준님이 카드에서 확인해야 노션 휴지통으로 이동돼(복구 가능). 상준님이 명시적으로 삭제를 요청했을 때만, 한 번에 한 페이지만 써.
대상 지정 규칙: [노션 조회 결과] 블록에 페이지 ID가 보이면 반드시 그 ID를 대상으로 써. 제목으로 지정했는데 같은 제목이 여러 개면 시스템이 후보 카드를 띄워 상준님이 고르고, 선택한 페이지가 ID와 함께 다음 메시지로 들어와. 수정·삭제처럼 실수하면 안 되는 작업은 대상이 확실하지 않으면 먼저 [[노션검색:...]]으로 확인해. 노션 관련 요청이 없으면 이 태그들을 절대 쓰지 마.

문자 전송 방법(시스템 명령): 상준님이 누군가에게 문자를 보내 달라고 하면 답변 맨 끝에 [[문자:수신번호|내용]] 태그를 붙여. 번호는 숫자만 쓰고(예: 01012345678), 내용은 상황에 맞게 정중하고 간결하게 초안을 써(90자 이내면 단문 요금, 길면 장문 요금). 태그를 붙여도 바로 발송되지 않고 상준님에게 확인 카드가 떠서 '전송'을 눌러야만 나가니, 초안을 자신 있게 담으면 돼. 받는 사람의 번호를 모르면 태그를 쓰지 말고 먼저 물어보고, 회사 메모리에 저장된 번호가 있으면 그걸 써. 태그 하나에 수신자 한 명이야. 요청이 없으면 절대 쓰지 마.

메일 전송 방법(시스템 명령): 상준님이 메일을 보내 달라고 하면 답변 맨 끝에 [[메일:받는주소|제목|본문]] 태그를 붙여. 제목은 한 줄로 용건이 드러나게, 본문은 인사–용건–마무리 순으로 정중한 비즈니스 메일 형식으로 쓰고 줄바꿈으로 문단을 나눠(서명은 상준님 이름으로). 문자와 마찬가지로 태그를 붙여도 바로 나가지 않고 확인 카드가 뜨니 초안을 자신 있게 써. 받는 사람 주소를 모르면 태그를 쓰지 말고 먼저 물어보고, 회사 메모리에 저장된 주소가 있으면 그걸 써. 태그 하나에 수신자 한 명이야. 요청이 없으면 절대 쓰지 마.

할 일 관리 방법(시스템 명령): 상준님이 할 일 추가를 요청하면 답변 맨 끝에 [[투두:할 일 내용]] 태그를, 완료 처리를 요청하면 [[투두완료:그 할 일의 핵심 키워드]] 태그를 붙여. 내용은 짧고 명확한 한 줄로 써. 날짜·시간이 정해진 약속은 투두가 아니라 일정/리마인더 태그를 써야 해. 요청이 없으면 절대 쓰지 마.

PDF 문서 방법(시스템 명령): 상준님이 PDF로 달라고 하거나 문서·보고서·견적서 파일로 뽑아 달라고 하면 답변 맨 끝에 [[PDF:제목|내용]] 태그를 붙여. 내용이 문서 본문 그대로 PDF가 되니 줄바꿈으로 문단·항목을 정리해 1200자 이내로 작성해. 본문에서는 '문서 준비됐다, 카드에서 다운로드하면 된다'고 짧게 말해. 요청이 없으면 절대 쓰지 마.

이미지 생성 방법(시스템 명령): 상준님이 이미지·시안·썸네일을 만들어 달라고 하면 답변 맨 끝에 [[이미지:프롬프트]] 태그를 붙여. 프롬프트는 영어로, 장면·스타일·조명·구도를 구체적으로 묘사해(예: modern Korean house exterior, warm sunset light, photorealistic, wide shot). 본문에서는 '생성 시작했다, 잠시 후 카드에 뜬다'고 짧게 말해. 요청이 없으면 절대 쓰지 마.

코워크 위임 방법(시스템 명령): 상준님이 자료 조사·비교 분석, 보고서/엑셀/문서 파일 제작, 웹페이지 개발·수정처럼 네가 채팅 답변만으로 완결할 수 없는 무거운 작업을 요청하거나 '코워크한테 시켜줘'라고 하면, 답변 맨 끝에 [[코워크:요청 상세]] 태그를 붙여. 요청 상세는 코워크(클라우드에서 일하는 실무 AI)가 이 대화를 못 본 상태에서도 바로 실행할 수 있게 목적·대상·결과물 형식을 구체적으로 적어. 본문에서는 '코워크에 접수했다, 완료되면 알려드린다'고 말해. 네가 채팅으로 바로 답할 수 있는 일은 위임하지 말고 직접 해.

출력 형식: 답변은 채팅 UI에 한 글자씩 타이핑되듯 표시되므로 마크다운 서식(별표 강조, 헤더, 코드블록 등) 없이 자연스러운 순수 텍스트로만 써. 목록이 필요하면 줄바꿈과 하이픈 정도만 사용해.`;

const DEPT_KEYS = {
  '마케팅팀': 'marketing', '마케팅': 'marketing',
  '설계팀': 'design', '설계': 'design',
  '시공팀': 'construction', '시공': 'construction',
  '정산팀': 'finance', '정산': 'finance',
  '법무팀': 'legal', '법무': 'legal',
  '영업팀': 'sales', '영업': 'sales',
  '전략기획팀': 'strategy', '전략기획': 'strategy', '전략': 'strategy',
  '일반': 'general',
};

const OVERLOAD_LINE =
  '으음… 그 질문은 제 회로가 정중히 사양하겠답니다. 다른 주제라면 뭐든 환영입니다.';

function sanitizeHistory(messages) {
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

function buildKnowledgeBlock(k) {
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

function buildSkillBlock(skills) {
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


function validateImage(img) {
  if (!img || typeof img !== 'object') return null;
  const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!types.includes(img.media_type)) return null;
  if (typeof img.data !== 'string' || !img.data || img.data.length > 6000000) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(img.data.slice(0, 120))) return null;
  return { media_type: img.media_type, data: img.data };
}

function toApiMessages(history, image) {
  if (!image) return history;
  const msgs = history.map((m) => ({ ...m }));
  const last = msgs[msgs.length - 1];
  last.content = [
    { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
    { type: 'text', text: typeof last.content === 'string' ? last.content : '이 이미지를 봐줘.' },
  ];
  return msgs;
}

function buildTimeBlock(now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return '\n\n현재 시각(한국): ' + fmt.format(now);
  } catch (_) {
    return '';
  }
}

function buildEventsBlock(events) {
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
      /* multi-day event → "7월 29일 ~ 7월 31일" */
      const end = e.end_at ? new Date(e.end_at) : null;
      if (end && !isNaN(end.getTime())) {
        const dayFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
        when = dayFmt.format(d) + ' ~ ' + dayFmt.format(end);
      }
    } catch (_) {}
    lines.push('- ' + when + ' ' + (e.kind === 'event' ? '[일정]' : '[리마인더]') + ' ' + e.title.slice(0, 200));
  }
  if (!lines.length) return null;
  return (
    '\n\n[등록된 일정·리마인더 — 시스템이 방금 조회한 목록]\n' +
    lines.join('\n') +
    '\n상준님이 일정이나 알림을 물으면 이 목록을 기준으로 답해.'
  );
}

/* Supabase insert for [[일정/리마인더]] tags — mirrors api/_lib/db.js defaults
   (publishable key is public-by-design; RLS scopes access) */
function sbConfig() {
  const url = (getEnv('SUPABASE_URL') || 'https://fussflufpfkvkijoxnjg.supabase.co').replace(/\/+$/, '');
  const key = getEnv('SUPABASE_KEY') || 'sb_publishable_Is1WTqh8ojmi9fz9N__mzA_wY8AxWIJ';
  return { url, key };
}

async function saveEvent(action) {
  try {
    const dueAt = `${action.date}T${action.time}:00+09:00`;
    if (isNaN(new Date(dueAt).getTime())) return;
    const { url, key } = sbConfig();
    const r = await fetch(url + '/rest/v1/joker_events', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: action.kind, title: action.title, due_at: dueAt }),
    });
    if (!r.ok) console.error('[joker edge] event save failed', r.status);
  } catch (err) {
    console.error('[joker edge] event save', err);
  }
}

/* [[기간일정:시작~끝|제목]] → 기간 일정 row (best-effort) */
async function saveRangeEvent(action) {
  try {
    const dueAt = `${action.start}T09:00:00+09:00`;
    const endAt = `${action.end}T18:00:00+09:00`;
    if (isNaN(new Date(dueAt).getTime()) || isNaN(new Date(endAt).getTime())) return;
    if (new Date(endAt) < new Date(dueAt)) return;
    const { url, key } = sbConfig();
    const r = await fetch(url + '/rest/v1/joker_events', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'event', title: action.title, due_at: dueAt, end_at: endAt }),
    });
    if (!r.ok) console.error('[joker edge] range save failed', r.status);
  } catch (err) {
    console.error('[joker edge] range save', err);
  }
}

/* [[일정삭제:키워드]] → 키워드와 맞는 일정 전부 삭제(최대 10건); 결과 카드 */
async function deleteEvents(keyword) {
  try {
    const { url, key } = sbConfig();
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    const kw = String(keyword).replace(/[%*]/g, '').trim().slice(0, 100);
    if (!kw) return { kind: 'event_delete', title: String(keyword), status: 'not_found' };
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const q = await fetch(
      url + '/rest/v1/joker_events?select=id,title&due_at=gte.' + encodeURIComponent(since) +
      '&title=ilike.' + encodeURIComponent('*' + kw + '*') + '&order=due_at.asc&limit=10',
      { headers }
    );
    if (!q.ok) return { kind: 'event_delete', title: kw, status: 'error' };
    const rows = await q.json().catch(() => []);
    if (!rows.length) return { kind: 'event_delete', title: kw, status: 'not_found' };
    const ids = rows.map((r) => r.id).join(',');
    const r = await fetch(url + '/rest/v1/joker_events?id=in.(' + ids + ')', { method: 'DELETE', headers });
    if (!r.ok) return { kind: 'event_delete', title: kw, status: 'error' };
    return { kind: 'event_delete', title: rows[0].title, status: 'ok', count: rows.length };
  } catch (err) {
    console.error('[joker edge] event delete', err);
    return { kind: 'event_delete', title: String(keyword), status: 'error' };
  }
}

/* [[일정변경:키워드|일시]] → 정확히 1건일 때만 시간 이동; 결과 카드 */
async function moveEvent(action) {
  try {
    const { url, key } = sbConfig();
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    const kw = String(action.title).replace(/[%*]/g, '').trim().slice(0, 100);
    const dueAt = `${action.date}T${action.time}:00+09:00`;
    if (!kw || isNaN(new Date(dueAt).getTime())) {
      return { kind: 'event_move', title: String(action.title), status: 'not_found' };
    }
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const q = await fetch(
      url + '/rest/v1/joker_events?select=id,title&due_at=gte.' + encodeURIComponent(since) +
      '&title=ilike.' + encodeURIComponent('*' + kw + '*') + '&order=due_at.asc&limit=2',
      { headers }
    );
    if (!q.ok) return { kind: 'event_move', title: kw, status: 'error' };
    const rows = await q.json().catch(() => []);
    if (!rows.length) return { kind: 'event_move', title: kw, status: 'not_found' };
    if (rows.length > 1) return { kind: 'event_move', title: kw, status: 'multiple' };
    const r = await fetch(url + '/rest/v1/joker_events?id=eq.' + rows[0].id, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ due_at: dueAt, notified: false }),
    });
    if (!r.ok) return { kind: 'event_move', title: rows[0].title, status: 'error' };
    return { kind: 'event_move', title: rows[0].title, status: 'ok', date: action.date, time: action.time };
  } catch (err) {
    console.error('[joker edge] event move', err);
    return { kind: 'event_move', title: String(action.title), status: 'error' };
  }
}

/* [[투두:내용]] → joker_todos row (best-effort) */
async function saveTodo(title) {
  try {
    const { url, key } = sbConfig();
    const r = await fetch(url + '/rest/v1/joker_todos', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: String(title).slice(0, 200) }),
    });
    if (!r.ok) console.error('[joker edge] todo save failed', r.status);
  } catch (err) {
    console.error('[joker edge] todo save', err);
  }
}

/* [[투두완료:키워드]] → mark first matching open todo done; returns card result */
async function completeTodo(keyword) {
  try {
    const { url, key } = sbConfig();
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    const kw = String(keyword).replace(/[%*]/g, '').trim().slice(0, 100);
    if (!kw) return { kind: 'todo_done', title: String(keyword), status: 'not_found' };
    const q = await fetch(
      url + '/rest/v1/joker_todos?select=id,title&done=eq.false&title=ilike.' +
      encodeURIComponent('*' + kw + '*') + '&order=created_at.asc&limit=1',
      { headers }
    );
    if (!q.ok) return { kind: 'todo_done', title: kw, status: 'error' };
    const rows = await q.json().catch(() => []);
    if (!rows.length) return { kind: 'todo_done', title: kw, status: 'not_found' };
    const r = await fetch(url + '/rest/v1/joker_todos?id=eq.' + rows[0].id, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ done: true, done_at: new Date().toISOString() }),
    });
    if (!r.ok) return { kind: 'todo_done', title: rows[0].title, status: 'error' };
    return { kind: 'todo_done', title: rows[0].title, status: 'ok' };
  } catch (err) {
    console.error('[joker edge] todo done', err);
    return { kind: 'todo_done', title: String(keyword), status: 'error' };
  }
}

/* [[코워크:요청]] → 작업 큐 row (best-effort) */
async function saveTask(request) {
  try {
    const { url, key } = sbConfig();
    const r = await fetch(url + '/rest/v1/joker_tasks', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ request: String(request).slice(0, 2000) }),
    });
    if (!r.ok) console.error('[joker edge] task save failed', r.status);
  } catch (err) {
    console.error('[joker edge] task save', err);
  }
}

/* [[노션:제목|내용]] → Notion page; returns the result the client renders */
async function saveNotion(action) {
  const key = getEnv('NOTION_API_KEY');
  const parent = getEnv('NOTION_PARENT_PAGE_ID');
  if (!key || !parent) return { kind: 'notion', title: action.title, status: 'not_configured' };
  try {
    const children = action.content.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 30)
      .map((t) => ({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 1800) } }] },
      }));
    const base = getEnv('NOTION_BASE_URL') || 'https://api.notion.com';
    const r = await fetch(base + '/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { page_id: parent.replace(/-/g, '') },
        properties: { title: { title: [{ type: 'text', text: { content: action.title.slice(0, 200) } }] } },
        children,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[joker edge notion]', r.status, JSON.stringify(j).slice(0, 300));
      return { kind: 'notion', title: action.title, status: 'error' };
    }
    return { kind: 'notion', title: action.title, status: 'saved', url: j.url || null };
  } catch (err) {
    console.error('[joker edge notion]', err);
    return { kind: 'notion', title: action.title, status: 'error' };
  }
}

/* ── Notion page ops (search/read/append/update/archive-confirm) ──
   Mirrors api/_lib/notion.js — keep the two in sync. */
const NOTION_VERSION = '2022-06-28';

function notionEnvEdge() {
  const key = getEnv('NOTION_API_KEY');
  const parent = getEnv('NOTION_PARENT_PAGE_ID');
  const base = getEnv('NOTION_BASE_URL') || 'https://api.notion.com';
  return { key, parent, base, configured: Boolean(key && parent) };
}

async function nfetch(env, path, opts = {}) {
  const r = await fetch(env.base + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + env.key,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[joker edge notion]', path, r.status, JSON.stringify(j).slice(0, 300));
    const e = new Error('notion_' + r.status);
    e.status = r.status;
    throw e;
  }
  return j;
}

function extractPageId(target) {
  const t = String(target || '').trim();
  const bare = t.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(bare)) return bare.toLowerCase();
  if (/notion\.(?:so|site|com)\//i.test(t)) {
    const m = t.match(/([0-9a-f]{32})(?:[^0-9a-f]|$)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function pageTitle(page) {
  try {
    const prop = Object.values(page.properties || {}).find((p) => p && p.type === 'title');
    const t = ((prop && prop.title) || []).map((x) => x.plain_text || '').join('').trim();
    return t || '(제목 없음)';
  } catch (_) {
    return '(제목 없음)';
  }
}

async function searchPages(env, query) {
  const j = await nfetch(env, '/v1/search', {
    method: 'POST',
    body: JSON.stringify({
      query: String(query).slice(0, 100),
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    }),
  });
  return (j.results || [])
    .filter((r) => r && r.object === 'page' && !r.archived)
    .map((p) => ({ id: p.id.replace(/-/g, ''), title: pageTitle(p), url: p.url || null }));
}

async function resolveTarget(env, target) {
  const id = extractPageId(target);
  if (id) {
    try {
      const page = await nfetch(env, '/v1/pages/' + id);
      if (page.archived) return { status: 'not_found' };
      return { page: { id, title: pageTitle(page), url: page.url || null } };
    } catch (_) {
      return { status: 'not_found' };
    }
  }
  const results = await searchPages(env, target);
  if (!results.length) return { status: 'not_found' };
  const wanted = String(target).trim();
  const exact = results.filter((r) => r.title.trim() === wanted);
  if (exact.length === 1) return { page: exact[0] };
  if (results.length === 1) return { page: results[0] };
  return { status: 'choose', candidates: results };
}

const TEXT_BLOCKS = {
  paragraph: '', heading_1: '# ', heading_2: '## ', heading_3: '### ',
  bulleted_list_item: '- ', numbered_list_item: '- ', to_do: '☐ ',
  quote: '> ', callout: '', toggle: '',
};

async function listBlocks(env, pageId) {
  const j = await nfetch(env, '/v1/blocks/' + pageId + '/children?page_size=100');
  return j.results || [];
}

function blocksToText(blocks, cap = 3000) {
  const lines = [];
  for (const b of blocks) {
    if (!b || typeof b.type !== 'string') continue;
    if (b.type === 'divider') { lines.push('---'); continue; }
    if (!(b.type in TEXT_BLOCKS)) continue;
    const conf = b[b.type];
    const txt = ((conf && conf.rich_text) || []).map((x) => x.plain_text || '').join('');
    if (txt.trim()) lines.push(TEXT_BLOCKS[b.type] + txt);
  }
  let out = lines.join('\n');
  if (out.length > cap) out = out.slice(0, cap) + '\n…(이하 생략)';
  return out;
}

function contentToBlocks(content) {
  return String(content).split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 30)
    .map((t) => ({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 1800) } }] },
    }));
}

async function appendBlocks(env, pageId, content) {
  await nfetch(env, '/v1/blocks/' + pageId + '/children', {
    method: 'PATCH',
    body: JSON.stringify({ children: contentToBlocks(content) }),
  });
}

async function replaceBlocks(env, pageId, content) {
  const blocks = await listBlocks(env, pageId);
  if (blocks.length > 30) return 'too_big';
  for (const b of blocks) {
    await nfetch(env, '/v1/blocks/' + b.id, { method: 'DELETE' });
  }
  await appendBlocks(env, pageId, content);
  return 'ok';
}

/* notion_delete performs NO write here — the client shows a confirmation
   card and the archive runs via POST /api/notion after the user confirms. */
async function runNotionOp(action) {
  const env = notionEnvEdge();
  const base = { kind: action.kind, title: action.target || action.query || '' };
  if (!env.configured) return { ...base, status: 'not_configured' };
  try {
    if (action.kind === 'notion_search') {
      const results = await searchPages(env, action.query);
      return { kind: 'notion_search', status: 'ok', query: action.query, results };
    }
    const r = await resolveTarget(env, action.target);
    if (!r.page) return { ...base, status: r.status, candidates: r.candidates };
    const page = r.page;
    if (action.kind === 'notion_read') {
      const content = blocksToText(await listBlocks(env, page.id));
      return { kind: 'notion_read', status: 'ok', page, content };
    }
    if (action.kind === 'notion_append') {
      await appendBlocks(env, page.id, action.content);
      return { kind: 'notion_append', status: 'ok', page };
    }
    if (action.kind === 'notion_update') {
      const status = await replaceBlocks(env, page.id, action.content);
      return { kind: 'notion_update', status, page };
    }
    if (action.kind === 'notion_delete') {
      return { kind: 'notion_delete', status: 'confirm', page };
    }
    return { ...base, status: 'error' };
  } catch (err) {
    console.error('[joker edge notion op]', action.kind, err);
    return { ...base, status: 'error' };
  }
}

/* Recent Notion read/search results (sent back by the client) → system block */
function buildNotionBlock(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const out = [];
  for (const it of items.slice(-2)) {
    if (!it || typeof it !== 'object') continue;
    if (it.kind === 'read' && it.title && typeof it.content === 'string') {
      out.push(
        '◆ 페이지 "' + String(it.title).slice(0, 100) + '" (ID: ' + String(it.id || '').slice(0, 40) + ')\n' +
        it.content.slice(0, 3000)
      );
    } else if (it.kind === 'search' && Array.isArray(it.results)) {
      const lines = it.results.slice(0, 5).map(
        (r) => '- ' + String((r && r.title) || '').slice(0, 80) + ' (ID: ' + String((r && r.id) || '').slice(0, 40) + ')'
      );
      out.push('◆ 검색 "' + String(it.query || '').slice(0, 60) + '" 결과\n' + (lines.join('\n') || '(결과 없음)'));
    }
  }
  if (!out.length) return null;
  return (
    '\n\n[노션 조회 결과 — 시스템이 방금 노션에서 가져온 실제 데이터]\n' +
    out.join('\n\n').slice(0, 8000) +
    '\n위 내용을 근거로 답하고, 해당 페이지에 추가·수정·삭제 태그를 쓸 때는 위 ID를 대상으로 정확히 써.'
  );
}

const CTRL = String.fromCharCode(0); /* NUL frame for control headers */

/* per-turn token/search usage → joker_usage row (best-effort) */
async function saveUsage(model, usage) {
  if (!usage || !Object.keys(usage).length) return;
  try {
    const { url, key } = sbConfig();
    const r = await fetch(url + '/rest/v1/joker_usage', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'turn',
        model,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        searches: (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0,
      }),
    });
    if (!r.ok) console.error('[joker edge] usage save failed', r.status);
  } catch (err) {
    console.error('[joker edge] usage save', err);
  }
}

const ACTION_TAG_RE =
  /\[\[\s*(일정|리마인더)\s*:\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})\s*\|\s*([^\]|]{1,150}?)\s*\]\]/;

const RANGE_TAG_RE =
  /\[\[\s*기간일정\s*:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^\]|]{1,150}?)\s*\]\]/;

const EVENT_DELETE_TAG_RE =
  /\[\[\s*일정삭제\s*:\s*([^\]|]{1,150}?)\s*\]\]/;
const EVENT_MOVE_TAG_RE =
  /\[\[\s*일정변경\s*:\s*([^\]|]{1,150}?)\s*\|\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})\s*\]\]/;

const NOTION_TAG_RE =
  /\[\[\s*노션\s*:\s*([^\]|]{1,100}?)\s*\|\s*([\s\S]{1,1500}?)\s*\]\]/;

const PDF_TAG_RE =
  /\[\[\s*PDF\s*:\s*([^\]|]{1,100}?)\s*\|\s*([\s\S]{1,1500}?)\s*\]\]/i;

const IMAGE_TAG_RE =
  /\[\[\s*이미지\s*:\s*([\s\S]{1,600}?)\s*\]\]/;

const COWORK_TAG_RE =
  /\[\[\s*코워크\s*:\s*([\s\S]{1,1000}?)\s*\]\]/;

/* [[문자:수신번호|내용]] — SMS draft; sent only via the confirmation card */
const SMS_TAG_RE =
  /\[\[\s*문자\s*:\s*([0-9][0-9\-\s]{8,15}?)\s*\|\s*([\s\S]{1,1000}?)\s*\]\]/;

/* [[메일:받는주소|제목|본문]] — e-mail draft; same confirm-then-send flow */
const MAIL_TAG_RE =
  /\[\[\s*메일\s*:\s*([^\]|\s]{5,120}?)\s*\|\s*([^\]|]{1,120}?)\s*\|\s*([\s\S]{1,3000}?)\s*\]\]/;

/* [[투두:내용]] / [[투두완료:키워드]] — to-do list add / complete */
const TODO_TAG_RE =
  /\[\[\s*투두\s*:\s*([^\]|]{1,200}?)\s*\]\]/;
const TODO_DONE_TAG_RE =
  /\[\[\s*투두완료\s*:\s*([^\]|]{1,200}?)\s*\]\]/;

/* Notion page-operation tags — target is a page id/URL or an exact title */
const NOTION_SEARCH_TAG_RE =
  /\[\[\s*노션검색\s*:\s*([^\]|]{1,100}?)\s*\]\]/;
const NOTION_READ_TAG_RE =
  /\[\[\s*노션읽기\s*:\s*([^\]|]{1,200}?)\s*\]\]/;
const NOTION_APPEND_TAG_RE =
  /\[\[\s*노션추가\s*:\s*([^\]|]{1,200}?)\s*\|\s*([\s\S]{1,1500}?)\s*\]\]/;
const NOTION_UPDATE_TAG_RE =
  /\[\[\s*노션수정\s*:\s*([^\]|]{1,200}?)\s*\|\s*([\s\S]{1,1500}?)\s*\]\]/;
const NOTION_DELETE_TAG_RE =
  /\[\[\s*노션삭제\s*:\s*([^\]|]{1,200}?)\s*\]\]/;

/* One [[...]] tag → action object, or null (mirrors api/_lib/core.js) */
function parseActionTag(tag) {
  let m;
  if ((m = tag.match(ACTION_TAG_RE))) {
    return {
      kind: m[1] === '일정' ? 'event' : 'reminder',
      date: m[2], time: m[3].padStart(5, '0'), title: m[4].trim(),
    };
  }
  if ((m = tag.match(RANGE_TAG_RE))) return { kind: 'event_range', start: m[1], end: m[2], title: m[3].trim() };
  if ((m = tag.match(EVENT_DELETE_TAG_RE))) return { kind: 'event_delete', title: m[1].trim() };
  if ((m = tag.match(EVENT_MOVE_TAG_RE))) {
    return { kind: 'event_move', title: m[1].trim(), date: m[2], time: m[3].padStart(5, '0') };
  }
  if ((m = tag.match(NOTION_TAG_RE))) return { kind: 'notion', title: m[1].trim(), content: m[2].trim() };
  if ((m = tag.match(NOTION_SEARCH_TAG_RE))) return { kind: 'notion_search', query: m[1].trim() };
  if ((m = tag.match(NOTION_READ_TAG_RE))) return { kind: 'notion_read', target: m[1].trim() };
  if ((m = tag.match(NOTION_APPEND_TAG_RE))) return { kind: 'notion_append', target: m[1].trim(), content: m[2].trim() };
  if ((m = tag.match(NOTION_UPDATE_TAG_RE))) return { kind: 'notion_update', target: m[1].trim(), content: m[2].trim() };
  if ((m = tag.match(NOTION_DELETE_TAG_RE))) return { kind: 'notion_delete', target: m[1].trim() };
  if ((m = tag.match(SMS_TAG_RE))) {
    return { kind: 'sms', to: m[1].replace(/[^0-9]/g, ''), content: m[2].trim() };
  }
  if ((m = tag.match(MAIL_TAG_RE))) {
    return { kind: 'mail', to: m[1].trim(), subject: m[2].trim(), content: m[3].trim() };
  }
  if ((m = tag.match(TODO_DONE_TAG_RE))) return { kind: 'todo_done', title: m[1].trim() };
  if ((m = tag.match(TODO_TAG_RE))) return { kind: 'todo', title: m[1].trim() };
  if ((m = tag.match(PDF_TAG_RE))) return { kind: 'pdf', title: m[1].trim(), content: m[2].trim() };
  if ((m = tag.match(IMAGE_TAG_RE))) return { kind: 'image', prompt: m[1].trim() };
  if ((m = tag.match(COWORK_TAG_RE))) return { kind: 'cowork', request: m[1].trim() };
  return null;
}

function createDeptTagFilter(writeText, writeHeader, onAction) {
  let buf = '';
  let deptDone = false;
  let tail = '';

  const emitInline = (text) => {
    let s = tail + text;
    tail = '';
    let out = '';
    for (;;) {
      const start = s.indexOf('[[');
      if (start === -1) {
        if (s.charAt(s.length - 1) === '[') { out += s.slice(0, -1); tail = '['; }
        else out += s;
        break;
      }
      out += s.slice(0, start);
      const end = s.indexOf(']]', start);
      if (end === -1) {
        const rest = s.slice(start);
        if (rest.length > 1800) out += rest;
        else tail = rest;
        break;
      }
      const tag = s.slice(start, end + 2);
      const action = parseActionTag(tag);
      s = s.slice(end + 2);
      if (action) {
        const deferred = action.kind.indexOf('notion') === 0 ||
          action.kind === 'todo_done' || action.kind === 'event_delete' || action.kind === 'event_move';
        if (!deferred) writeHeader('\u0000action:' + JSON.stringify(action) + '\u0000');
        if (onAction) { try { onAction(action); } catch (_) {} }
        if (s.charAt(0) === '\n') s = s.slice(1);
        while (out.length && (out.endsWith(' ') || out.endsWith('\n'))) out = out.slice(0, -1);
      } else {
        out += tag;
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

/* Env values pasted into the Netlify UI can carry invisible unicode (zero-width
   spaces, NBSP…) which makes Deno's Request constructor reject the header as a
   non-ByteString. Our env values (API key, model id, base URL) are all printable
   ASCII, so strip anything else. */
function cleanEnv(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[^\x20-\x7E]/g, '').trim();
  return s || undefined;
}

function getEnv(k) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
      const v = cleanEnv(Netlify.env.get(k));
      if (v !== undefined) return v;
    }
  } catch (_) {}
  try {
    if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
      const v = cleanEnv(Deno.env.get(k));
      if (v !== undefined) return v;
    }
  } catch (_) {}
  try {
    if (typeof process !== 'undefined' && process.env) return cleanEnv(process.env[k]);
  } catch (_) {}
  return undefined;
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/* debug-only: how each env source sees the key, without leaking it —
   raw length + char codes of the first 10 chars (the "sk-ant-api" prefix
   region, which is public knowledge for Anthropic keys) */
function envDiagnostics(k) {
  const probe = (fn) => {
    try {
      const v = fn();
      if (v === undefined || v === null) return null;
      const s = String(v);
      return { len: s.length, head: [...s.slice(0, 10)].map((c) => c.codePointAt(0)) };
    } catch (err) {
      return { err: String(err && err.message || err) };
    }
  };
  return {
    netlify: probe(() => (typeof Netlify !== 'undefined' && Netlify.env ? Netlify.env.get(k) : undefined)),
    deno: probe(() => (typeof Deno !== 'undefined' && Deno.env ? Deno.env.get(k) : undefined)),
    process: probe(() => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined)),
  };
}

export default async function handler(request) {
  let debug = false;
  try {
    debug = new URL(request.url).searchParams.get('debug') === '1';
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    let body = {};
    try { body = await request.json(); } catch (_) {}
    const history = sanitizeHistory(body.messages);
    if (!history) return json(400, { error: 'invalid_messages' });

    /* Netlify masks credential-looking env values (sk-ant-…) before edge
       functions can read them, so the key is stored base64-encoded under a
       neutral name (JOKER_BRAIN_KEY). Plain ANTHROPIC_API_KEY is the fallback
       for platforms that deliver env values untouched. */
    let apiKey;
    const encoded = getEnv('JOKER_BRAIN_KEY');
    if (encoded) {
      try { apiKey = atob(encoded).trim(); } catch (_) {}
    }
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      const plain = getEnv('ANTHROPIC_API_KEY');
      /* a masked value survives cleanEnv as a short "sk-ant-a" stub — reject it */
      if (plain && plain.length > 40) apiKey = plain;
    }
    if (!apiKey) {
      return json(500, debug
        ? { error: 'server_not_configured', detail: 'env_missing_after_clean' }
        : { error: 'server_not_configured' });
    }

    const knowledgeBlock = buildKnowledgeBlock(body.knowledge);
    const skillBlock = buildSkillBlock(body.skills);

    const upstream = await fetch((getEnv('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: getEnv('JOKER_MODEL') || MODEL_DEFAULT,
        max_tokens: 2048,
        stream: true,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT + buildTimeBlock() + (knowledgeBlock || '') + (skillBlock || '') + (buildEventsBlock(body.events) || '') + (buildNotionBlock(body.notion) || ''),
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
        messages: toApiMessages(history, validateImage(body.image)),
      }),
    });

    if (!upstream.ok) {
      const status = upstream.status;
      const detail = await upstream.text().catch(() => '');
      console.error('[joker edge] upstream', status, detail);
      /* keyInfo: safe fingerprint (prefix + length only) to diagnose mangled env values */
      const keyInfo = apiKey.slice(0, 7) + '…len' + apiKey.length;
      if (status === 401 || status === 403) {
        return json(500, debug
          ? { error: 'server_not_configured', detail: 'upstream_' + status + ' key=' + keyInfo, env: envDiagnostics('ANTHROPIC_API_KEY') }
          : { error: 'server_not_configured' });
      }
      if (status === 429) return json(429, { error: 'rate_limited' });
      if (status === 400 && /credit balance/i.test(detail)) return json(402, { error: 'no_credits' });
      if (status === 400) return json(500, debug ? { error: 'server_not_configured', detail } : { error: 'server_not_configured' });
      return json(502, { error: 'upstream_error' });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        let emitted = 0;
        const pendingWrites = [];
        const filter = createDeptTagFilter(
          (text) => { emitted += text.length; controller.enqueue(encoder.encode(text)); },
          (header) => controller.enqueue(encoder.encode(header)),
          (action) => {
            if (action.kind === 'notion') {
              pendingWrites.push(saveNotion(action).then((result) => {
                controller.enqueue(encoder.encode(CTRL + 'action:' + JSON.stringify(result) + CTRL));
              }).catch((e) => console.error('[joker edge] notion', e)));
            } else if (action.kind.indexOf('notion_') === 0) {
              pendingWrites.push(runNotionOp(action).then((result) => {
                controller.enqueue(encoder.encode(CTRL + 'action:' + JSON.stringify(result) + CTRL));
              }).catch((e) => console.error('[joker edge] notion op', e)));
            } else if (action.kind === 'todo') {
              pendingWrites.push(saveTodo(action.title));
            } else if (action.kind === 'todo_done') {
              pendingWrites.push(completeTodo(action.title).then((result) => {
                controller.enqueue(encoder.encode(CTRL + 'action:' + JSON.stringify(result) + CTRL));
              }).catch((e) => console.error('[joker edge] todo done', e)));
            } else if (action.kind === 'cowork') {
              pendingWrites.push(saveTask(action.request));
            } else if (action.kind === 'event' || action.kind === 'reminder') {
              pendingWrites.push(saveEvent(action));
            } else if (action.kind === 'event_range') {
              pendingWrites.push(saveRangeEvent(action));
            } else if (action.kind === 'event_delete') {
              pendingWrites.push(deleteEvents(action.title).then((result) => {
                controller.enqueue(encoder.encode(CTRL + 'action:' + JSON.stringify(result) + CTRL));
              }).catch((e) => console.error('[joker edge] event delete', e)));
            } else if (action.kind === 'event_move') {
              pendingWrites.push(moveEvent(action).then((result) => {
                controller.enqueue(encoder.encode(CTRL + 'action:' + JSON.stringify(result) + CTRL));
              }).catch((e) => console.error('[joker edge] event move', e)));
            }
          },
        );

        let sseBuf = '';
        let stopReason = null;
        const turnUsage = {}; /* merged from message_start + message_delta events */
        const mergeUsage = (u) => {
          if (!u || typeof u !== 'object') return;
          for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
            if (typeof u[k] === 'number') turnUsage[k] = u[k];
          }
          if (u.server_tool_use && typeof u.server_tool_use.web_search_requests === 'number') {
            turnUsage.server_tool_use = { web_search_requests: u.server_tool_use.web_search_requests };
          }
        };
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            const lines = sseBuf.split('\n');
            sseBuf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              let ev;
              try { ev = JSON.parse(line.slice(6)); } catch (_) { continue; }
              if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
                filter.feed(ev.delta.text);
              } else if (ev.type === 'message_start' && ev.message) {
                mergeUsage(ev.message.usage);
              } else if (ev.type === 'message_delta') {
                if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
                mergeUsage(ev.usage);
              }
            }
          }
          filter.flush();
          pendingWrites.push(saveUsage(getEnv('JOKER_MODEL') || MODEL_DEFAULT, turnUsage));
          await Promise.all(pendingWrites);
          if (stopReason === 'refusal' && emitted === 0) {
            controller.enqueue(encoder.encode(OVERLOAD_LINE));
          }
        } catch (err) {
          console.error('[joker edge] stream', err);
        } finally {
          try { controller.close(); } catch (_) {}
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    console.error('[joker edge] fatal', err);
    return json(500, debug
      ? { error: 'internal_error', detail: String(err && (err.stack || err.message || err)) }
      : { error: 'internal_error' });
  }
}

export const config = { path: '/api/chat' };
