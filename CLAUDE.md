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
- 문자(솔라피): 모델이 [[문자:수신번호|내용]] 태그를 붙이면 채팅에는 전송 확인
  카드만 뜨고, 사용자가 "전송"을 눌러야 POST /api/sms(api/sms.js)가 솔라피
  HMAC-SHA256 인증으로 1건 발송한다(수신자 1명 제한). SOLAPI_API_KEY·
  SOLAPI_API_SECRET·SOLAPI_SENDER(사전 등록 발신번호) 미설정 시 501 →
  카드에 안내. 채팅 스트림 핸들러는 절대 직접 발송하지 않는다. 공용 클라이언트는
  `api/_lib/solapi.js`(solapiEnv/normalizeNumber/sendSms).
- 메일(Resend/SendGrid): 모델이 [[메일:받는주소|제목|본문]] 태그를 붙이면 문자와
  똑같이 전송 확인 카드만 뜨고, "전송"을 눌러야 POST /api/mail(api/mail.js)이
  1통 발송한다(수신자 1명). 공용 클라이언트는 `api/_lib/mail.js` —
  RESEND_API_KEY가 있으면 Resend, 없고 SENDGRID_API_KEY가 있으면 SendGrid를
  쓰고, MAIL_FROM(발신 주소, "이름 <a@b>" 형식 가능)은 필수. MAIL_REPLY_TO는
  선택. 미설정 시 501 → 카드에 안내, 제공자 오류 사유(발신 주소 미인증 등)는
  detail로 카드에 표시된다.
- 리마인더 문자: netlify/functions/reminder-sms.mjs가 넷리파이 예약 실행
  (`config.schedule='*/2 * * * *'`)으로 기한 도래한 joker_events를 찾아
  본인 번호(JOKER_SMS_TO, 없으면 SOLAPI_SENDER)로 문자를 보낸다. 중복 방지용
  joker_events.sms_sent 컬럼 필요(setup.sql, 기존 설치는 alter 1줄 재실행).
  기한 6시간 이내·1회 최대 5건만 처리하고, 4xx 실패는 표시해 재시도를 멈추되
  네트워크 오류는 다음 실행에서 재시도한다. 클라이언트 알림용 notified 플래그는
  건드리지 않으며 JOKER_SMS_REMINDERS=off로 끌 수 있다.
- js/reminders.js가 /api/events를 폴링해 기한 도래 시 말풍선·음성·브라우저
  알림을 울리고, js/calendar.js가 사이트 내 월별 캘린더 패널(헤더 📅 버튼)을
  그린다. 웹 검색은 Anthropic 서버측 web_search 도구로 켜져 있다.
- 캘린더 조작 태그: [[기간일정:YYYY-MM-DD~YYYY-MM-DD|제목]](joker_events.end_at,
  due 시작일 09:00·end 종료일 18:00, 미니/큰 캘린더가 날짜별로 펼쳐 띠 표시),
  [[일정삭제:키워드]](ilike 매칭 전부 삭제, 최대 10건, count 카드),
  [[일정변경:키워드|일시]](정확히 1건일 때만 이동+notified 리셋, 다건이면
  multiple 카드). 두 챗 백엔드 동일 구현, 결과는 삭제·변경만 지연 헤더.
- 할 일(투두): joker_todos 테이블(setup.sql), /api/todos(api/todos.js,
  GET 목록·POST add/done/undone/delete). 모델 태그 [[투두:내용]](즉시 등록)과
  [[투두완료:키워드]](ilike 매칭 후 결과 카드, ok/not_found)를 두 챗 백엔드가
  처리. 사이드바 ☑️ 섹션에서 체크·추가·삭제 가능.
- 아침 브리핑(js/brief.js): 매일 KST 8시 이후 그날 첫 접속 시(localStorage
  joker.brief.last로 1일 1회) 오늘 일정+미완료 투두+최근 24h 노션 업데이트를
  클라이언트에서 조합해 JokerChat.notify로 말풍선+TTS. LLM 호출 없음(무료).
  사이드바 ☀️ 버튼 = JokerBrief.run(true) 수동 재생.
- AI 직원(팀 모드): joker_staff 테이블(setup.sql — 기본 직원 6명을 테이블이 비었을
  때만 시드), /api/staff(api/staff.js, GET 목록·POST add/update/delete).
  js/staff.js가 명부·선택 상태(localStorage joker.staff.pick.v1)를 들고,
  사이드바 👥 팀에서 카드를 누르거나 대화 앞머리에서 이름을 부르면("세리야 ~")
  담당자가 바뀐다. 선택되면 클라이언트가 body.staff로 페르소나를 보내고
  `buildStaffBlock`(코어·엣지 동일)이 시스템 프롬프트에 [담당 직원 모드]로
  주입해 그 직원 말투로 응대한다(도구·태그는 조커와 동일, 부서 태그는 직원
  부서로 고정). 직원 추가·수정은 설정 패널 TEAM 탭.
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
- AI 직원(팀): joker_staff 테이블 + /api/staff. 사이드바 👥 팀에서 담당자를 고르거나
  이름을 부르면(js/staff.js detect) 그 직원 페르소나가 주입된다(core.js
  buildStaffBlock). 명부는 매 요청 body.team으로 실려 buildTeamBlock이 시스템
  프롬프트에 [팀 명부]로 넣는다.
- 직원 업무 지시(실제 작업): 모델이 [[업무:직원이름|내용]] 태그를 붙이면 두 챗
  백엔드가 joker_staff_tasks에 pending으로 접수하고(api/_lib/staff-tasks.js,
  엣지는 인라인 사본) 지연 헤더로 배정 카드를 보낸다. 실행은 워커
  api/staff-run.js — 그 직원 페르소나 + 회사 메모리 + 웹 검색으로 결과를 만들어
  result에 저장하고 노션 페이지도 만든다(설정 시 notion_url). 결과에서 [부서:]와
  [[...]] 태그는 전부 잘라내므로 백그라운드에서 문자·메일 발송이 일어날 수 없다.
  넷리파이는 10초 제한을 피하려고 staff-run-background.mjs(15분)가 실제 실행을,
  staff-run.mjs(/api/staff-run)가 트리거를 맡고, staff-tick.mjs가 5분마다 대기
  건이 있을 때만 깨운다(창을 닫아둬도 진행). 프론트는 배정 직후 워커를 깨우고
  /api/staff-tasks를 폴링해 카드 뱃지(배정됨→작업 중→완료 ✓)와 사이드바 '작업 중'
  표시를 갱신하고 완료 시 말풍선으로 알린다. running으로 15분 이상 멈춘 건은
  pending으로 되돌린다. JOKER_STAFF_WORKER=off로 끌 수 있다.
- 이미지 생성: 모델이 [[이미지:영어 프롬프트]] 태그를 붙이면 클라이언트가
  /api/media(api/media.js, 힉스필드 Higgsfield 프록시)로 잡 생성 후 폴링해
  완성 이미지를 카드에 띄운다. HIGGSFIELD_CREDENTIALS("keyId:secret",
  cloud.higgsfield.ai/api-keys에서 발급) 미설정 시 501 → 카드에 안내 표시.
- 방 감시(카메라): watch.html + js/watch.js가 방에 놓아둔 기기(주로 안 쓰는 폰)에서
  카메라를 지켜본다. 움직임 감지는 브라우저에서 캔버스 프레임 차이로 공짜로 하고
  (64x48 흑백, 기본 문턱 6%), 움직임이 잡힌 순간에만 사진 1장을 /api/watch
  (api/watch.js)로 보내 판별한다. 판별은 값싼 모델(JOKER_WATCH_MODEL, 기본 Haiku)로
  하고 joker_watch_faces에 등록해 둔 참고 사진(최대 3장)과 대조해
  owner/stranger/unsure/none을 낸다. stranger면 서버가 솔라피로 문자를 보내고
  (10분 쿨다운·하루 20건, 번호는 JOKER_SMS_TO→SOLAPI_SENDER) 그 건만 사진을
  joker_watch_events에 남긴다. owner면 클라이언트가 10분 이상 부재였을 때만 TTS로
  인사한다. 판별 최소 간격 30초, 본인 확인 후 3분 침묵, 시간당 150회 서버 한도.
  참고 사진이 없으면 절대 stranger로 단정하지 않는다(항상 unsure). 테이블은
  setup.sql, 킬 스위치는 JOKER_WATCH=off. 사이드바 👁️ 버튼이 watch.html을 연다.
- 집 CCTV 연결: tools/cctv-bridge.mjs를 집의 상시 켜둔 PC/라즈베리파이에서 돌리면
  RTSP나 스냅샷 JPEG 주소에서 ffmpeg로 프레임을 뽑아 같은 /api/watch로 보낸다
  (움직임 판단은 64x48 흑백 rawvideo, 전송용은 640폭 JPEG — 움직일 때만 두 번째
  호출). --url/--motion-url/--server/--interval/--min/--threshold/--once,
  FFMPEG 환경변수로 실행 파일 경로 지정 가능. Tapo처럼 스트림이 둘이면
  --motion-url에 저화질(stream2)을 주면 감시는 거기서, 판별 사진만 고화질에서
  받는다. 서버리스라 조커가 집 안 카메라에 직접 접속할 수 없어
  이 다리가 필요하다.
