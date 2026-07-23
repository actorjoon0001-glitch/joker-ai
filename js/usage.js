/* Usage meter — polls /api/usage and shows an estimated remaining-credit chip
   in the header, with a detail popover (today/this month, set-base input).
   Costs are estimates computed server-side from recorded token usage.
   Hidden when the backend/table isn't available. */
(() => {
  'use strict';

  const chip = document.getElementById('usageChip');
  const pop = document.getElementById('usagePop');
  if (!chip || !pop) return;

  const elToday = document.getElementById('usageToday');
  const elMonth = document.getElementById('usageMonth');
  const elBase = document.getElementById('usageBase');
  const baseInput = document.getElementById('usageBaseInput');
  const baseSave = document.getElementById('usageBaseSave');

  let available = location.protocol !== 'file:';
  let data = null;

  const fmt = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

  function render() {
    if (!data) return;
    chip.hidden = false;
    chip.classList.remove('low');
    if (data.remaining != null) {
      chip.textContent = '⚡ 약 ' + fmt(Math.max(0, data.remaining)) + ' 남음';
      if (data.remaining < 3) chip.classList.add('low');
    } else {
      chip.textContent = '⚡ 이번 달 ' + fmt(data.month.cost);
    }
    const line = (p) =>
      `${fmt(p.cost)} · 대화 ${p.turns}회 · 검색 ${p.searches}회`;
    if (elToday) elToday.textContent = line(data.today);
    if (elMonth) elMonth.textContent = line(data.month);
    if (elBase) {
      elBase.textContent = data.base
        ? fmt(data.base.amount) + ' (' + new Date(data.base.at).toLocaleDateString('ko-KR') + ' 충전 기준)'
        : '미설정 — 충전 금액을 입력해두면 남은 금액을 보여드려요';
    }
  }

  async function refresh() {
    if (!available) return;
    try {
      const r = await fetch('api/usage');
      if (r.status === 503 || r.status === 404 || r.status === 405 || r.status === 501) {
        available = false;
        chip.hidden = true;
        return;
      }
      if (!r.ok) return;
      data = await r.json();
      render();
    } catch {}
  }

  chip.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) refresh();
  });

  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== chip) pop.hidden = true;
  });

  if (baseSave && baseInput) {
    baseSave.addEventListener('click', async () => {
      const amount = Number(baseInput.value);
      if (!isFinite(amount) || amount <= 0) {
        baseInput.focus();
        return;
      }
      baseSave.disabled = true;
      baseSave.textContent = '저장 중…';
      try {
        const r = await fetch('api/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'set_base', amount }),
        });
        if (r.ok) {
          baseInput.value = '';
          await refresh();
          baseSave.textContent = '저장 완료 ✓';
        } else {
          baseSave.textContent = '실패 — 다시 시도';
        }
      } catch {
        baseSave.textContent = '실패 — 다시 시도';
      }
      setTimeout(() => {
        baseSave.textContent = '이 금액 기준으로 잔액 계산';
        baseSave.disabled = false;
      }, 1800);
    });
  }

  window.JokerUsage = { refresh };
  refresh();
  setInterval(refresh, 5 * 60 * 1000);
})();
