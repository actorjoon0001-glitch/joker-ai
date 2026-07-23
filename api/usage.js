/* /api/usage — API 사용량 집계와 예상 잔액.
   GET → { base, remaining, today, month }  각 기간은 {cost, input, output, searches, turns}
   POST {op:'set_base', amount} → 충전 금액 기준점 저장 (이후 사용분을 빼서 잔액 추정)
   비용은 claude-opus-4-8 단가 기준 추정치: 입력 $5/M, 출력 $25/M,
   캐시 쓰기 $6.25/M, 캐시 읽기 $0.5/M, 웹 검색 $10/1000회. */
import { sb, isDbNotReady } from './_lib/db.js';

const PRICE = {
  input: 5 / 1e6,
  output: 25 / 1e6,
  cacheWrite: 6.25 / 1e6,
  cacheRead: 0.5 / 1e6,
  search: 10 / 1000,
};

function rowCost(r) {
  return (
    (r.input_tokens || 0) * PRICE.input +
    (r.output_tokens || 0) * PRICE.output +
    (r.cache_write_tokens || 0) * PRICE.cacheWrite +
    (r.cache_read_tokens || 0) * PRICE.cacheRead +
    (r.searches || 0) * PRICE.search
  );
}

function sumSince(rows, sinceMs) {
  const acc = { cost: 0, input: 0, output: 0, searches: 0, turns: 0 };
  for (const r of rows) {
    if (r.kind !== 'turn') continue;
    const t = new Date(r.created_at).getTime();
    if (isNaN(t) || t < sinceMs) continue;
    acc.cost += rowCost(r);
    acc.input += (r.input_tokens || 0) + (r.cache_write_tokens || 0) + (r.cache_read_tokens || 0);
    acc.output += r.output_tokens || 0;
    acc.searches += r.searches || 0;
    acc.turns += 1;
  }
  acc.cost = Math.round(acc.cost * 10000) / 10000;
  return acc;
}

/* start of today / this month in KST, as epoch ms */
function kstBoundaries(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now); /* YYYY-MM-DD */
  const dayStart = new Date(day + 'T00:00:00+09:00').getTime();
  const monthStart = new Date(day.slice(0, 8) + '01T00:00:00+09:00').getTime();
  return { dayStart, monthStart };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const r = await sb('joker_usage?select=*&order=created_at.desc&limit=1000');
      if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
      if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
      const rows = await r.json();

      const base = rows.find((x) => x.kind === 'base' && x.amount_usd != null) || null;
      const { dayStart, monthStart } = kstBoundaries();
      const today = sumSince(rows, dayStart);
      const month = sumSince(rows, monthStart);

      let remaining = null;
      if (base) {
        const sinceBase = sumSince(rows, new Date(base.created_at).getTime());
        remaining = Math.round((Number(base.amount_usd) - sinceBase.cost) * 100) / 100;
      }

      res.status(200).json({
        base: base ? { amount: Number(base.amount_usd), at: base.created_at } : null,
        remaining,
        today,
        month,
      });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.op === 'set_base') {
        const amount = Number(b.amount);
        if (!isFinite(amount) || amount < 0 || amount > 100000) {
          res.status(400).json({ error: 'invalid_amount' });
          return;
        }
        const r = await sb('joker_usage', {
          method: 'POST',
          body: JSON.stringify({ kind: 'base', amount_usd: amount }),
        });
        if (isDbNotReady(r.status)) { res.status(503).json({ error: 'db_not_ready' }); return; }
        if (!r.ok) { res.status(502).json({ error: 'db_error' }); return; }
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: 'invalid_op' });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker usage]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
