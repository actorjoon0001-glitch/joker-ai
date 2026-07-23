# Claude 작업 규칙

## 워크플로

- 작업이 끝나면 항상 새 PR을 만들어 main에 바로 머지한다 (상준님 지시, 2026-07).
  브랜치 푸시 → PR 생성 → 즉시 머지까지가 한 사이클이며, 머지 대기나 리뷰
  요청 없이 자동으로 진행한다.

## 코드베이스 메모

- 프론트엔드는 빌드 없는 순수 JS(IIFE, `js/`), 백엔드는 `api/chat.js`
  (Vercel 서버리스 호환, ESM). 자세한 구조는 README 참고.
- 컴퍼니 메모리(`buildKnowledgeBlock`)는 매 요청 주입, 스킬(`buildSkillBlock`)은
  발동 키워드가 걸린 요청에만 주입된다.
- 컴퍼니 메모리와 대화 기록은 Supabase에 저장된다(`api/memory.js`,
  `api/history.js`, 스키마는 `supabase/setup.sql` — 대시보드에서 1회 실행 필요).
  Supabase가 준비 안 됐으면 503(db_not_ready)을 반환하고 프론트는
  localStorage로 폴백한다. 스킬은 아직 localStorage에만 저장된다.
- 음성 답변은 `/api/tts`(api/tts.js, 엣지 사본 netlify/edge-functions/tts.js)가
  일레븐랩스를 프록시한다. ELEVENLABS_API_KEY 미설정 시 501을 반환하고
  프론트(js/voice.js)는 브라우저 내장 speechSynthesis로 폴백한다.
- 조커의 액션 태그: 모델이 답변에 `[[리마인더/일정:YYYY-MM-DD HH:MM|제목]]` 또는
  `[[노션:제목|내용]]`을 붙이면 스트림 필터(core.js·엣지 사본)가 잘라내
  NUL 프레임 `action:` 헤더로 클라이언트에 전달한다. 일정/리마인더는 서버가
  Supabase joker_events에 저장하고, 노션은 NOTION_API_KEY·NOTION_PARENT_PAGE_ID
  환경변수가 있을 때 노션 페이지를 생성한다(없으면 not_configured 카드).
- js/reminders.js가 /api/events를 폴링해 기한 도래 시 말풍선·음성·브라우저
  알림을 울리고, js/calendar.js가 사이트 내 월별 캘린더 패널(헤더 📅 버튼)을
  그린다. 웹 검색은 Anthropic 서버측 web_search 도구로 켜져 있다.
- 사용량 미터: 두 챗 백엔드가 턴별 토큰·검색 수를 joker_usage에 기록하고
  /api/usage(api/usage.js)가 opus-4-8 단가로 비용을 추정, js/usage.js가 헤더
  잔액 칩(⚡)을 그린다. 크레딧 소진은 402 no_credits로 매핑된다.
- PDF: 모델이 [[PDF:제목|내용]] 태그를 붙이면 클라이언트(js/pdf.js)가
  vendor/jspdf + vendor/nanum-font.js(한글 폰트, 지연 로딩)로 .pdf를 만들어
  다운로드 카드를 띄운다. 서버 작업 없음.
- 이미지 생성: 모델이 [[이미지:영어 프롬프트]] 태그를 붙이면 클라이언트가
  /api/media(api/media.js, 힉스필드 Higgsfield 프록시)로 잡 생성 후 폴링해
  완성 이미지를 카드에 띄운다. HIGGSFIELD_CREDENTIALS("keyId:secret",
  cloud.higgsfield.ai/api-keys에서 발급) 미설정 시 501 → 카드에 안내 표시.
