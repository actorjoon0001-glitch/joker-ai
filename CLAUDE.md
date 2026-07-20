# Claude 작업 규칙

## 워크플로

- 작업이 끝나면 항상 새 PR을 만들어 main에 바로 머지한다 (상준님 지시, 2026-07).
  브랜치 푸시 → PR 생성 → 즉시 머지까지가 한 사이클이며, 머지 대기나 리뷰
  요청 없이 자동으로 진행한다.

## 코드베이스 메모

- 프론트엔드는 빌드 없는 순수 JS(IIFE, `js/`), 백엔드는 `api/chat.js`
  (Vercel 서버리스 호환, ESM). 자세한 구조는 README 참고.
- 컴퍼니 메모리(`buildKnowledgeBlock`)는 매 요청 주입, 스킬(`buildSkillBlock`)은
  발동 키워드가 걸린 요청에만 주입된다. 사용자 등록 데이터는 모두 브라우저
  localStorage에 저장된다.
