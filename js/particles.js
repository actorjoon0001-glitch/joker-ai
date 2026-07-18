/* Background ambient particles (lightweight 2D canvas) */
(() => {
  'use strict';
  const cv = document.getElementById('particles');
  const cx = cv.getContext('2d');
  let W, H, parts;

  function resize() {
    W = cv.width = innerWidth * devicePixelRatio;
    H = cv.height = innerHeight * devicePixelRatio;
    cv.style.width = innerWidth + 'px';
    cv.style.height = innerHeight + 'px';
  }

  function init() {
    const n = Math.min(70, Math.floor(innerWidth / 14));
    parts = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: (Math.random() * 1.4 + 0.4) * devicePixelRatio,
      vx: (Math.random() - 0.5) * 0.12 * devicePixelRatio,
      vy: (-Math.random() * 0.18 - 0.04) * devicePixelRatio,
      a: Math.random() * 0.5 + 0.1,
      tw: Math.random() * Math.PI * 2,
    }));
  }

  function tick(t) {
    cx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      const glow = p.a * (0.6 + 0.4 * Math.sin(t * 0.001 + p.tw));
      cx.beginPath();
      cx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      cx.fillStyle = `rgba(120, 210, 255, ${glow})`;
      cx.fill();
    }
    requestAnimationFrame(tick);
  }

  addEventListener('resize', () => { resize(); init(); });
  resize(); init(); requestAnimationFrame(tick);
})();
