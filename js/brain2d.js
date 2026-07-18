/* Brain2D — lightweight 2D canvas neural brain, used as the fallback when WebGL is
   unavailable or the FPS governor gives up on the 3D version.
   Exposes window.Brain2D.create(canvas) → {think, idle, burst, destroy}. */
(() => {
  'use strict';

  const OUTLINE = [
    [-0.92, 0.10], [-0.88, -0.18], [-0.72, -0.42], [-0.50, -0.58],
    [-0.22, -0.68], [0.08, -0.70], [0.38, -0.64], [0.62, -0.50],
    [0.80, -0.30], [0.90, -0.05], [0.88, 0.18], [0.76, 0.38],
    [0.62, 0.42], [0.66, 0.55], [0.55, 0.68], [0.38, 0.70],
    [0.24, 0.62], [0.18, 0.48], [-0.05, 0.52], [-0.32, 0.50],
    [-0.58, 0.42], [-0.78, 0.30],
  ];

  function inBrain(x, y) {
    let inside = false;
    for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
      const [xi, yi] = OUTLINE[i], [xj, yj] = OUTLINE[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  const COLORS = {
    idle:     { node: [52, 224, 255],  edge: [52, 224, 255],  sig: [88, 255, 155] },
    thinking: { node: [178, 107, 255], edge: [178, 107, 255], sig: [52, 224, 255] },
    burst:    { node: [88, 255, 155],  edge: [52, 224, 255],  sig: [178, 107, 255] },
  };

  /* outline-space (x right, y down) → department region id, mirroring brain3d */
  function regionOf2D(x, y) {
    if (x > 0.5 && y > 0.35) return 6;                 /* 정산팀 — cerebellum bump */
    if (y < -0.3) return 2;                            /* 마케팅팀 — top */
    if (x > 0.5) return 1;                             /* 전략기획팀 — front */
    if (x < -0.5) return 5;                            /* 시공팀 — rear */
    if (y > 0.3 && Math.abs(x) < 0.35) return 7;       /* 법무팀 — bottom center */
    if (x > 0) return 3;                               /* 영업팀 */
    return 4;                                          /* 설계팀 */
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function create(canvas) {
    const cx = canvas.getContext('2d');
    let cw, ch, nodes = [], edges = [], signals = [], rings = [];
    let state = 'idle';
    let burstUntil = 0;
    let raf = 0, dead = false, lastSpawn = 0;
    let activeRegion = 0, regionRgb = [255, 255, 255];

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      cw = rect.width; ch = rect.height;
      canvas.width = cw * devicePixelRatio;
      canvas.height = ch * devicePixelRatio;
      cx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      build();
    }

    function build() {
      nodes = []; edges = []; signals = [];
      const scale = Math.min(cw / 2.1, ch / 1.55);
      const ox = cw / 2, oy = ch / 2 - ch * 0.03;
      const target = cw < 500 ? 54 : 84;
      let guard = 0;
      while (nodes.length < target && guard++ < 6000) {
        const x = (Math.random() * 2 - 1) * 0.95;
        const y = (Math.random() * 1.5 - 0.75) * 0.98;
        if (!inBrain(x, y)) continue;
        const px = ox + x * scale, py = oy + y * scale;
        if (nodes.some(n => (n.x - px) ** 2 + (n.y - py) ** 2 < (scale * 0.11) ** 2)) continue;
        nodes.push({
          x: px, y: py, bx: px, by: py,
          r: Math.random() * 1.8 + 1.4,
          ph: Math.random() * Math.PI * 2,
          sp: Math.random() * 0.6 + 0.7,
          drift: Math.random() * Math.PI * 2,
          region: regionOf2D(x, y),
        });
      }
      const maxD = scale * 0.34;
      for (let i = 0; i < nodes.length; i++) {
        const cand = [];
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const d = Math.hypot(nodes[i].bx - nodes[j].bx, nodes[i].by - nodes[j].by);
          if (d < maxD) cand.push({ j, d });
        }
        cand.sort((a, b) => a.d - b.d);
        for (const c of cand.slice(0, 3)) {
          const key = i < c.j ? `${i}-${c.j}` : `${c.j}-${i}`;
          if (!edges.some(e => e.key === key)) edges.push({ a: i, b: c.j, key });
        }
      }
    }

    function spawnSignal() {
      if (!edges.length) return;
      const e = edges[(Math.random() * edges.length) | 0];
      signals.push({
        e, t: 0,
        speed: (state === 'thinking' ? 0.045 : 0.014) * (0.7 + Math.random() * 0.6),
        dir: Math.random() < 0.5 ? 1 : -1,
      });
    }

    function burst() {
      state = 'burst';
      burstUntil = performance.now() + 1400;
      const oy = ch / 2 - ch * 0.03;
      rings.push({ x: cw / 2, y: oy, r: 10, max: Math.max(cw, ch) * 0.75, a: 0.8 });
      setTimeout(() => { if (!dead) rings.push({ x: cw / 2, y: oy, r: 10, max: Math.max(cw, ch) * 0.75, a: 0.55 }); }, 180);
      for (let k = 0; k < 14; k++) spawnSignal();
    }

    function tick(t) {
      if (dead) return;
      raf = requestAnimationFrame(tick);
      cx.clearRect(0, 0, cw, ch);
      if (state === 'burst' && t > burstUntil) state = 'idle';
      const col = COLORS[state];
      const speedMul = state === 'thinking' ? 3.2 : state === 'burst' ? 2.2 : 1;

      const interval = state === 'thinking' ? 90 : 700;
      if (t - lastSpawn > interval) { spawnSignal(); lastSpawn = t; }

      for (const n of nodes) {
        n.x = n.bx + Math.sin(t * 0.00045 * n.sp + n.drift) * 3.2;
        n.y = n.by + Math.cos(t * 0.0004 * n.sp + n.drift * 1.7) * 3.2;
      }

      cx.lineWidth = 1;
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const flick = state === 'thinking' ? 0.5 + 0.5 * Math.random() : 1;
        cx.strokeStyle = `rgba(${col.edge}, ${0.10 * flick})`;
        cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
      }

      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        s.t += s.speed * speedMul;
        if (s.t >= 1) { signals.splice(i, 1); continue; }
        const a = nodes[s.e.a], b = nodes[s.e.b];
        const p = s.dir > 0 ? s.t : 1 - s.t;
        const x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
        const grd = cx.createRadialGradient(x, y, 0, x, y, 6);
        grd.addColorStop(0, `rgba(${col.sig}, 0.9)`);
        grd.addColorStop(1, `rgba(${col.sig}, 0)`);
        cx.fillStyle = grd;
        cx.beginPath(); cx.arc(x, y, 6, 0, Math.PI * 2); cx.fill();
      }

      for (const n of nodes) {
        const inRegion = activeRegion && n.region === activeRegion;
        const nodeCol = inRegion ? regionRgb : col.node;
        const pulseSpeed = state === 'thinking' ? 0.012 : 0.0022;
        const pulse = 0.55 + 0.45 * Math.sin(t * pulseSpeed * n.sp + n.ph);
        const r = n.r * (0.8 + pulse * 0.5) * (inRegion ? 1.35 : 1);
        const grd = cx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4);
        grd.addColorStop(0, `rgba(${nodeCol}, ${(inRegion ? 0.95 : 0.75) * pulse})`);
        grd.addColorStop(0.35, `rgba(${nodeCol}, ${(inRegion ? 0.35 : 0.22) * pulse})`);
        grd.addColorStop(1, `rgba(${nodeCol}, 0)`);
        cx.fillStyle = grd;
        cx.beginPath(); cx.arc(n.x, n.y, r * 4, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = `rgba(235, 250, 255, ${0.5 + 0.5 * pulse})`;
        cx.beginPath(); cx.arc(n.x, n.y, r * 0.55, 0, Math.PI * 2); cx.fill();
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i];
        g.r += (g.max - g.r) * 0.055 + 2.2;
        g.a *= 0.965;
        if (g.a < 0.02) { rings.splice(i, 1); continue; }
        cx.strokeStyle = `rgba(88, 255, 155, ${g.a})`;
        cx.lineWidth = 1.6;
        cx.beginPath(); cx.arc(g.x, g.y, g.r, 0, Math.PI * 2); cx.stroke();
        cx.strokeStyle = `rgba(52, 224, 255, ${g.a * 0.5})`;
        cx.beginPath(); cx.arc(g.x, g.y, g.r * 0.86, 0, Math.PI * 2); cx.stroke();
      }
    }

    addEventListener('resize', resize);
    resize();
    raf = requestAnimationFrame(tick);

    return {
      think() { state = 'thinking'; },
      idle() { state = 'idle'; },
      burst,
      setDept(deptKey) {
        const d = deptKey && window.DEPTS && window.DEPTS[deptKey];
        activeRegion = d ? d.id : 0;
        if (d) regionRgb = hexToRgb(d.color);
      },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        removeEventListener('resize', resize);
      },
    };
  }

  window.Brain2D = { create };
})();
