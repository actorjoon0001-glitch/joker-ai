# JOKER — 뇌 모양 AI 비서 채팅

아이언맨 자비스 스타일의 3D 뇌 비주얼 + Claude API 연동 채팅 웹앱.

## 구성

| 경로 | 역할 |
|---|---|
| `index.html` | 페이지 마크업 + 스타일 |
| `js/brain3d.js` | Three.js 파티클 뇌 (GLSL 셰이더 맥동/신호, GSAP 상태 전환, FPS 거버너) |
| `js/brain2d.js` | 2D 캔버스 폴백 뇌 (WebGL 미지원·저사양 기기) |
| `js/chat.js` | 채팅 UI, 스트리밍 타이핑 효과, 오프라인 데모 모드 |
| `js/main.js` | 3D/2D 부트 선택 및 폴백 스왑 |
| `api/chat.js` | Claude API 스트리밍 백엔드 (Vercel 서버리스 함수 호환) |
| `server.js` | 로컬 개발 서버 |
| `vendor/` | three.js, GSAP (오프라인 동작을 위해 번들) |

## 실행

### 로컬 (실제 LLM 대화)

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# http://localhost:3000
```

API 키는 서버에서만 사용되며 프론트엔드에 노출되지 않습니다.

### Vercel 배포

저장소를 Vercel에 연결하고 환경 변수 `ANTHROPIC_API_KEY`만 설정하면
`api/chat.js`가 자동으로 서버리스 함수로 배포됩니다.

### 백엔드 없이 (데모 모드)

`index.html`을 브라우저로 그냥 열면 조커가 내장된 위트 응답으로 대답하는
오프라인 데모 모드로 동작합니다.

## 옵션

- 모델 변경: 환경 변수 `JOKER_MODEL` (기본 `claude-opus-4-8`)
- 강제 렌더 모드: URL에 `?mode=2d` 또는 `?mode=3d`
- FPS 거버너 끄기(테스트용): `?gov=0`

## 성능 폴백

3D 뇌는 60fps를 유지하지 못하면 단계적으로 품질을 낮춥니다:
해상도(DPR) 축소 → 파티클/연결선 수 축소 → 2D 캔버스 뇌로 전환.
모바일은 처음부터 파티클 수를 절반으로 시작합니다.
