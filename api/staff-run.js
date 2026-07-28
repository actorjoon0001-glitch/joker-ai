/* POST /api/staff-run — AI 직원 백그라운드 워커.
   joker_staff_tasks의 pending 건을 집어(claim) 그 직원의 페르소나로 실제 작업을
   수행하고 결과를 result에 채운다. 결과가 길기 때문에 노션이 연동돼 있으면
   문서로도 남기고 링크를 notion_url에 저장한다.

   호출 경로는 셋:
   - 프론트가 업무를 접수한 직후 즉시 한 번 (js/staff.js)
   - 넷리파이 예약 함수가 5분마다 (netlify/functions/staff-tick.mjs)
   - 넷리파이에서는 -background 함수로 매핑돼 15분까지 돌 수 있다

   되돌리기 어려운 일(문자·메일 발송, 삭제, 결제)은 워커가 직접 하지 않는다.
   시스템 태그를 결과에서 전부 잘라내므로 백그라운드에서 발송이 일어날 수 없다.
   JOKER_STAFF_WORKER=off로 기능만 끌 수 있다. */
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_DEFAULT, DEPT_LABELS, buildTimeBlock, buildKnowledgeBlock } from './_lib/core.js';
import { sb } from './_lib/db.js';
import { notionEnv, contentToBlocks } from './_lib/notion.js';

const MODEL = process.env.JOKER_STAFF_MODEL || process.env.JOKER_MODEL || MODEL_DEFAULT;
const MAX_PER_RUN = 3;
const STALE_MS = 15 * 60 * 1000; /* running 상태로 멈춘 건 다시 집는다 */

const WORKER_PROMPT =
`너는 상준님(사장님)의 회사에서 일하는 AI 직원이야. 지금은 채팅이 아니라 배정받은 업무를 실제로 처리하는 중이고, 결과물은 문서로 저장돼 상준님이 나중에 읽는다.

작성 규칙:
- 결론부터 쓰고, 근거와 세부는 그 뒤에 정리해. 상준님이 그대로 쓸 수 있는 완성된 결과물을 내놔.
- 마크다운 서식(별표 강조, #헤더, 코드블록)은 쓰지 말고 순수 텍스트로 써. 소제목 한 줄과 하이픈 목록 정도만 사용해.
- 분량은 A4 한 장 정도(1500자 안팎). 짧은 업무면 더 짧아도 된다.
- 확실하지 않은 사실이나 최신 정보가 필요하면 웹 검색으로 확인하고, 출처는 매체·업체 이름 정도로 자연스럽게 언급해. 검색해도 모르면 모른다고 쓰고 무엇을 확인해야 하는지 남겨.
- 맨 마지막에 '다음 액션'으로 상준님이 이어서 할 일을 2~3줄 제안해.
- 되돌리기 어려운 일(문자·메일 발송, 삭제, 결제, 계약)은 네가 실행하지 말고 결과물 안에 '상준님 확인 필요'로 남겨.
- [[...]] 같은 시스템 태그나 [부서:...] 태그는 절대 쓰지 마. 인사말·서론 없이 바로 결과물부터 시작해.`;

/* 직원 정보 → 워커용 페르소나 블록 */
function personaBlock(t) {
  const team = DEPT_LABELS[t.dept || ''] || '';
  const role = (t.role || '').trim();
  return (
    '\n\n[너는 누구인가]\n이름: ' + t.staff_name + (role ? ' / 역할: ' + role : '') +
    (team ? ' / 소속: ' + team : '') +
    ((t.persona || '').trim() ? '\n업무 스타일: ' + String(t.persona).trim().slice(0, 2000) : '') +
    '\n네 전문 분야의 관점으로 처리해.'
  );
}

/* 결과 텍스트에서 남아 있을 수 있는 시스템 태그를 제거한다(백그라운드에서
   문자·메일·삭제 같은 액션이 실행되는 것을 원천 차단). */
export function stripTags(text) {
  return String(text || '')
    .replace(/^\s*\[부서\s*:[^\]]{0,20}\]\s*/, '')
    .replace(/\[\[[\s\S]{0,2000}?\]\]/g, '')
    .trim();
}

async function loadKnowledge() {
  try {
    const r = await sb('joker_memory?id=eq.1&select=data');
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return (rows[0] && rows[0].data) || null;
  } catch {
    return null;
  }
}

/* 같은 이름의 직원 페르소나를 붙여준다(지시함에는 이름만 저장돼 있다) */
async function loadPersona(task) {
  if (!task.staff_id) return {};
  try {
    const r = await sb(`joker_staff?id=eq.${task.staff_id}&select=role,persona,dept`);
    if (!r.ok) return {};
    const rows = await r.json().catch(() => []);
    return rows[0] || {};
  } catch {
    return {};
  }
}

async function patch(id, body) {
  return sb(`joker_staff_tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  });
}

/* 낙관적 claim — pending일 때만 running으로 바꾸고, 바뀐 행이 없으면 다른
   실행이 이미 가져간 것이므로 건너뛴다(중복 실행·중복 과금 방지). */
async function claim(id) {
  try {
    const r = await sb(`joker_staff_tasks?id=eq.${id}&status=eq.pending`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'running', updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/* 결과를 노션 문서로도 남긴다(설정돼 있을 때만). 실패해도 작업은 성공 처리. */
async function saveToNotion(task, text) {
  const env = notionEnv();
  if (!env.configured) return null;
  try {
    const title = ('[' + task.staff_name + '] ' + task.request).slice(0, 90);
    const r = await fetch(env.base + '/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.key,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { page_id: env.parent.replace(/-/g, '') },
        properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
        children: contentToBlocks('지시: ' + task.request + '\n\n' + text),
      }),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return j.url || null;
  } catch {
    return null;
  }
}

async function saveUsage(usage) {
  if (!usage) return;
  try {
    await sb('joker_usage', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'staff',
        model: MODEL,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        searches: (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0,
      }),
    });
  } catch {}
}

async function runOne(client, task, knowledge) {
  const extra = await loadPersona(task);
  const system = WORKER_PROMPT + buildTimeBlock() +
    (buildKnowledgeBlock(knowledge) || '') +
    personaBlock({ ...task, ...extra });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: '아래 업무를 처리해줘.\n\n' + task.request }],
  });
  const text = stripTags(
    (msg.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim()
  );
  await saveUsage(msg.usage);
  if (!text) throw new Error('empty_result');
  const url = await saveToNotion(task, text);
  await patch(task.id, { status: 'done', result: text.slice(0, 12000), notion_url: url });
  return true;
}

/* running으로 멈춰 있는(함수가 중간에 죽은) 건을 다시 pending으로 되돌린다 */
async function requeueStale() {
  try {
    const before = new Date(Date.now() - STALE_MS).toISOString();
    await sb(
      `joker_staff_tasks?status=eq.running&updated_at=lt.${encodeURIComponent(before)}`,
      { method: 'PATCH', body: JSON.stringify({ status: 'pending' }) }
    );
  } catch {}
}

export async function runPending() {
  if (String(process.env.JOKER_STAFF_WORKER || '').toLowerCase() === 'off') return { ran: 0, reason: 'disabled' };
  await requeueStale();

  let pending = [];
  try {
    const r = await sb(
      'joker_staff_tasks?select=*&status=eq.pending&order=created_at.asc&limit=' + MAX_PER_RUN
    );
    if (r.status === 404) return { ran: 0, reason: 'db_not_ready' };
    if (!r.ok) return { ran: 0, reason: 'db_error' };
    pending = await r.json().catch(() => []);
  } catch {
    return { ran: 0, reason: 'db_error' };
  }
  if (!pending.length) return { ran: 0 };

  const client = new Anthropic();
  const knowledge = await loadKnowledge();
  let ran = 0;
  for (const task of pending) {
    if (!(await claim(task.id))) continue;
    try {
      await runOne(client, task, knowledge);
      ran++;
    } catch (err) {
      console.error('[joker staff-run]', task.id, err);
      const reason = err && /credit balance/i.test(String(err.message || '')) ? '크레딧이 부족해서 중단됐어요.' : '';
      await patch(task.id, {
        status: 'failed',
        result: reason || '작업 중 오류가 났어요. 다시 시켜주시면 재시도합니다.',
      }).catch(() => {});
    }
  }
  return { ran };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    res.status(200).json(await runPending());
  } catch (err) {
    console.error('[joker staff-run]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}

export const config = { maxDuration: 300 };
