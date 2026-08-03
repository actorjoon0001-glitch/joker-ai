/* 집에 있는 CCTV(IP캠)를 조커 감시에 물리는 다리.

   조커는 서버리스라 집 안의 카메라에 직접 접속할 수 없다. 그래서 집에 있는
   컴퓨터(항상 켜두는 PC, 라즈베리파이, 시놀로지 등)에서 이 스크립트를 돌리면
   카메라 → 이 스크립트 → 조커 서버(/api/watch) 순으로 사진이 전달된다.

   watch.html(폰 카메라)과 판별·문자·기록은 완전히 같은 경로를 쓴다.

   준비물: ffmpeg, Node 18+
     macOS   brew install ffmpeg
     윈도우   winget install Gyan.FFmpeg
     라즈베리  sudo apt install ffmpeg

   실행:
     node tools/cctv-bridge.mjs \
       --url "rtsp://아이디:비번@192.168.0.30:554/stream1" \
       --server "https://내조커주소"

   카메라 주소(--url)는 RTSP 주소든 스냅샷 JPEG 주소든 상관없다.
   기종별 RTSP 주소는 제조사 앱의 '고급 설정'이나 매뉴얼에 있다.

   옵션:
     --interval  초  움직임을 살피는 주기 (기본 3)
     --min       초  판별 요청 최소 간격 (기본 30)
     --threshold %   이만큼 화면이 바뀌면 움직임으로 본다 (기본 6)
     --once          한 번만 확인하고 끝낸다 (연결 점검용) */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const GRID_W = 64, GRID_H = 48, SEND_W = 640;
/* 윈도우처럼 PATH에 없는 경우 FFMPEG=C:\...\ffmpeg.exe 로 지정할 수 있다 */
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

export function parseArgs(argv) {
  const out = { interval: 3, min: 30, threshold: 6, once: false, server: 'http://localhost:3000' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'once') { out.once = true; continue; }
    const val = argv[++i];
    if (val === undefined) continue;
    if (['interval', 'min', 'threshold'].includes(key)) out[key] = Number(val);
    else out[key] = val;
  }
  out.server = String(out.server).replace(/\/+$/, '');
  return out;
}

/* 축소한 흑백 프레임 두 장의 픽셀 변화 비율(%) — watch.js와 같은 기준 */
export function motionRatio(prev, now) {
  if (!prev || !now || prev.length !== now.length || !now.length) return 0;
  let changed = 0;
  for (let i = 0; i < now.length; i++) {
    if (Math.abs(now[i] - prev[i]) > 22) changed++;
  }
  return (changed / now.length) * 100;
}

function ffmpegArgs(url, extra) {
  /* RTSP는 UDP로 받으면 프레임이 깨지는 집이 많아 TCP로 고정한다 */
  const base = ['-loglevel', 'error', '-y'];
  if (url.startsWith('rtsp://')) base.push('-rtsp_transport', 'tcp');
  return base.concat(['-i', url, '-frames:v', '1'], extra, ['-']);
}

/* 움직임 판단용 — 64x48 흑백 원본. 아주 가볍다. */
async function grabGray(url) {
  const { stdout } = await run(
    FFMPEG,
    ffmpegArgs(url, ['-vf', `scale=${GRID_W}:${GRID_H},format=gray`, '-f', 'rawvideo']),
    { encoding: 'buffer', maxBuffer: 1 << 20, timeout: 20000 }
  );
  return new Uint8Array(stdout);
}

/* 서버로 보낼 사진 — 움직임이 잡혔을 때만 부른다 */
async function grabJpeg(url) {
  const { stdout } = await run(
    FFMPEG,
    ffmpegArgs(url, ['-vf', `scale=${SEND_W}:-2`, '-q:v', '6', '-f', 'image2']),
    { encoding: 'buffer', maxBuffer: 8 << 20, timeout: 20000 }
  );
  return stdout.toString('base64');
}

async function check(cfg, data) {
  const res = await fetch(cfg.server + '/api/watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'check', image: { media_type: 'image/jpeg', data } }),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...j };
}

function say(text) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${text}`);
}

function report(j) {
  if (!j.ok) {
    if (j.error === 'db_not_ready') say('감시 테이블이 아직 없습니다 (supabase/setup.sql 실행 필요)');
    else if (j.error === 'disabled') say('서버에서 감시가 꺼져 있습니다 (JOKER_WATCH=off)');
    else if (j.error === 'rate_limited') say('감지가 너무 잦아 서버가 잠시 막았습니다');
    else say('판별 실패: ' + (j.error || j.status));
    return;
  }
  if (j.verdict === 'owner') say('상준님이 보입니다 — ' + (j.detail || ''));
  else if (j.verdict === 'stranger') say('⚠ 모르는 사람 — ' + (j.detail || '') + ' / 문자: ' + j.sms);
  else if (j.verdict === 'unsure') say('사람은 있는데 누군지 불확실 — ' + (j.detail || ''));
  else say('사람 없음 — ' + (j.detail || ''));
}

export async function main(argv) {
  const cfg = parseArgs(argv);
  if (!cfg.url) {
    console.error('카메라 주소가 없습니다.\n  node tools/cctv-bridge.mjs --url "rtsp://..." --server "https://내조커주소"');
    process.exitCode = 1;
    return;
  }
  try {
    await run(FFMPEG, ['-version'], { timeout: 10000 });
  } catch {
    console.error('ffmpeg를 찾을 수 없습니다. 먼저 설치해 주세요.');
    process.exitCode = 1;
    return;
  }

  if (cfg.once) {
    say('카메라에서 사진을 한 장 받아 판별해 봅니다…');
    report(await check(cfg, await grabJpeg(cfg.url)));
    return;
  }

  say(`감시 시작 — ${cfg.interval}초마다 확인, 화면이 ${cfg.threshold}% 이상 바뀌면 판별합니다.`);
  let prev = null, lastCheck = 0, fails = 0;
  for (;;) {
    try {
      const gray = await grabGray(cfg.url);
      fails = 0;
      const ratio = motionRatio(prev, gray);
      prev = gray;
      if (ratio >= cfg.threshold && Date.now() - lastCheck >= cfg.min * 1000) {
        lastCheck = Date.now();
        report(await check(cfg, await grabJpeg(cfg.url)));
      }
    } catch (err) {
      fails++;
      /* 카메라가 잠깐 끊기는 건 흔하다 — 조용히 넘기고 계속 붙어 있는다 */
      if (fails === 1 || fails % 20 === 0) say('카메라를 읽지 못했습니다 (' + fails + '회): ' + String(err.message).slice(0, 120));
    }
    await new Promise((r) => setTimeout(r, cfg.interval * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
