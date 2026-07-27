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
- 음성 호출어: js/wakeword.js가 상시 SpeechRecognition으로 "조커/joker" 호출을
  감지(호출 전 발화는 전부 무시), 감지 후 받아쓰기→무음 2.2초에 자동 전송.
  헤더 토글 + 상태 표시등(클릭 시 민감도 전환), 소리 알림 없음. TTS 재생 중에는
  window.__jokerSpeaking 플래그로 자기 목소리를 무시한다.
- 음성 답변은 `/api/tts`(api/tts.js, 엣지 사본 netlify/edge-functions/tts.js)가
  일레븐랩스를 프록시한다. ELEVENLABS_API_KEY 미설정 시 501을 반환하고
  프론트(js/voice.js)는 브라우저 내장 speechSynthesis로 폴백한다.
- TTS 말 속도: 설정 패널 VOICE 탭 슬라이더(0.6~1.6, localStorage
  joker.tts.rate.v1, 즉시 적용·저장). 내장 음성은 utterance.rate에 곱하고,
  일레븐랩스는 body.rate → voice_settings.speed(0.7~1.2 클램프, 400이면 speed
  빼고 1회 재시도) + 잔여분은 audio.playbackRate로 보정해 두 모드 체감 속도를
  맞춘다. JokerVoice.{getRate,setRate,preview} 노출.
- 조커의 액션 태그: 모델이 답변에 `[[리마인더/일정:YYYY-MM-DD HH:MM|제목]]` 또는
  `[[노션:제목|내용]]`을 붙이면 스트림 필터(core.js `parseActionTag`·엣지 사본)가
  잘라내 NUL 프레임 `action:` 헤더로 클라이언트에 전달한다. 일정/리마인더는 서버가
  Supabase joker_events에 저장하고, 노션은 NOTION_API_KEY·NOTION_PARENT_PAGE_ID
  환경변수가 있을 때 노션 페이지를 생성한다(없으면 not_configured 카드).
- 노션 페이지 조작 태그: `[[노션검색:검색어]]` / `[[노션읽기:ID나 제목]]` /
  `[[노션추가:ID나 제목|내용]]`(맨 아래 append) / `[[노션수정:ID나 제목|새 내용 전체]]`
  (본문 교체, 30블록 초과 시 too_big 거절) / `[[노션삭제:ID나 제목]]`. 공용 로직은
  `api/_lib/notion.js`(엣지 사본은 chat.js 안에 인라인). 제목이 여러 페이지와 겹치면
  choose 카드로 후보를 보여주고 사용자가 골라야 진행된다. 검색·읽기 결과는
  클라이언트(js/chat.js notionCtx)가 다음 요청 body.notion으로 되보내
  `buildNotionBlock`이 시스템 프롬프트에 [노션 조회 결과]로 주입한다.
- 노션 삭제 안전장치: 서버는 [[노션삭제]]에서 절대 바로 지우지 않고 confirm 카드만
  띄운다. 사용자가 카드의 "삭제 확인"을 눌러야 클라이언트가 POST /api/notion
  (api/notion.js, op:'archive', 페이지 1개만 허용)을 호출해 노션 휴지통으로
  보낸다(archived:true, 복구 가능). 대량 삭제 경로는 의도적으로 없다.
- js/reminders.js가 /api/events를 폴링해 기한 도래 시 말풍선·음성·브라우저
  알림을 울리고, js/calendar.js가 사이트 내 월별 캘린더 패널(헤더 📅 버튼)을
  그린다. 웹 검색은 Anthropic 서버측 web_search 도구로 켜져 있다.
- 할 일(투두): joker_todos 테이블(setup.sql), /api/todos(api/todos.js,
  GET 목록·POST add/done/undone/delete). 모델 태그 [[투두:내용]](즉시 등록)과
  [[투두완료:키워드]](ilike 매칭 후 결과 카드, ok/not_found)를 두 챗 백엔드가
  처리. 사이드바 ☑️ 섹션에서 체크·추가·삭제 가능.
- 아침 브리핑(js/brief.js): 매일 KST 8시 이후 그날 첫 접속 시(localStorage
  joker.brief.last로 1일 1회) 오늘 일정+미완료 투두+최근 24h 노션 업데이트를
  클라이언트에서 조합해 JokerChat.notify로 말풍선+TTS. LLM 호출 없음(무료).
  사이드바 ☀️ 버튼 = JokerBrief.run(true) 수동 재생.
- 왼쪽 퀵 사이드바(js/sidebar.js): 노션 페이지 목록(GET /api/notion?op=list,
  최근 수정순, 제목 클릭=노션 열기, 💬=조커가 읽어오기, 🗑=인라인 삭제/취소
  확인 후 POST /api/notion archive로 휴지통 이동)과 미니 달력(월 이동,
  일정 점 표시, 날짜 클릭 시 큰 캘린더) + 다가오는 일정 6건을 상시 표시. 열림 상태는 localStorage joker.sidebar.v1에 유지되고
  첫 방문 시 넓은 화면(≥1280px)에서 자동으로 열린다. 열리면 body.sb-open이
  .app 컬럼을 오른쪽으로 밀어 채팅과 겹치지 않는다(≤900px는 오버레이).
- 사용량 미터: 두 챗 백엔드가 턴별 토큰·검색 수를 joker_usage에 기록하고
  /api/usage(api/usage.js)가 opus-4-8 단가로 비용을 추정, js/usage.js가 헤더
  잔액 칩(⚡)을 그린다. 크레딧 소진은 402 no_credits로 매핑된다.
- PDF: 모델이 [[PDF:제목|내용]] 태그를 붙이면 클라이언트(js/pdf.js)가
  vendor/jspdf + vendor/nanum-font.js(한글 폰트, 지연 로딩)로 .pdf를 만들어
  다운로드 카드를 띄운다. 서버 작업 없음.
- 코워크 작업 큐: 모델이 [[코워크:요청]] 태그를 붙이면 서버가 joker_tasks에
  저장하고, 코워크(클로드 CCR 세션)의 매시간 루틴(trig_01AgTiEqYt587FRAtA6Lf6zN)이
  pending을 실행해 done/failed + result로 갱신한다. 프론트(js/reminders.js)가
  /api/tasks를 폴링해 완료 알림을 채팅에 띄운다. 채팅의 코워크 카드에는 상태
  뱃지(접수됨→작업 중→완료 ✓/실패, js/chat.js trackCoworkTask)가 붙어 45초
  간격 폴링으로 갱신되고, 완료 시 결과 요약과 "결과 보기" 링크(결과 속 첫
  URL)를 카드에 표시한다. 진행바/퍼센트는 쓰지 않는다.
- 이미지 생성: 모델이 [[이미지:영어 프롬프트]] 태그를 붙이면 클라이언트가
  /api/media(api/media.js, 힉스필드 Higgsfield 프록시)로 잡 생성 후 폴링해
  완성 이미지를 카드에 띄운다. HIGGSFIELD_CREDENTIALS("keyId:secret",
  cloud.higgsfield.ai/api-keys에서 발급) 미설정 시 501 → 카드에 안내 표시.
