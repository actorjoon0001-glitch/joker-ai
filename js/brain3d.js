/* Brain3D — Three.js particle brain with GLSL pulse/signal shaders and GSAP state
   transitions. Exposes window.Brain3D.create(canvas, opts) → {think, idle, burst, destroy}.
   opts.onFallback is called when the FPS governor gives up (caller switches to Brain2D). */
(() => {
  'use strict';

  const POINT_VERT = `
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aSize;
    attribute float aSeed;
    uniform float uTime;
    uniform float uActivity;
    uniform float uPixelRatio;
    varying float vPulse;
    varying float vSeed;
    varying float vDist;
    void main() {
      float speed = mix(0.9, 6.0, uActivity);
      vPulse = 0.5 + 0.5 * sin(uTime * speed * aSpeed + aPhase);
      vSeed = aSeed;
      vDist = length(position);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (0.75 + vPulse * 0.7) * uPixelRatio * (7.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const POINT_FRAG = `
    precision mediump float;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    uniform float uMix;
    uniform float uBurstR;
    uniform float uBurstAmp;
    varying float vPulse;
    varying float vSeed;
    varying float vDist;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float a = smoothstep(1.0, 0.0, d);
      a *= a;
      vec3 col = mix(uColorA, uColorB, uMix);
      col = mix(col, uColorB, step(0.86, vSeed) * 0.7);
      col = mix(col, uColorC, step(0.94, vSeed) * 0.85);
      float burst = smoothstep(0.35, 0.0, abs(vDist - uBurstR)) * uBurstAmp;
      col += uColorC * burst * 1.6;
      float alpha = a * (0.22 + 0.55 * vPulse) + burst * a * 0.8;
      gl_FragColor = vec4(col * alpha, alpha);
    }
  `;

  const LINE_VERT = `
    attribute float aT;
    attribute float aSeed;
    varying float vT;
    varying float vSeed;
    varying float vDist;
    void main() {
      vT = aT;
      vSeed = aSeed;
      vDist = length(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const LINE_FRAG = `
    precision mediump float;
    uniform float uTime;
    uniform float uActivity;
    uniform float uMix;
    uniform float uBurstR;
    uniform float uBurstAmp;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    varying float vT;
    varying float vSeed;
    varying float vDist;
    void main() {
      vec3 base = mix(uColorA, uColorB, uMix);
      /* traveling light pulse along the edge */
      float speed = mix(0.10, 0.65, uActivity) * (0.6 + fract(vSeed * 7.31) * 0.9);
      float p = fract(uTime * speed + vSeed);
      float pulse = smoothstep(0.10, 0.0, abs(vT - p));
      /* only a fraction of edges carry signals when idle */
      float gate = step(1.0 - mix(0.22, 1.0, uActivity), fract(vSeed * 13.7 + floor(uTime * speed + vSeed)));
      pulse *= max(gate, uActivity);
      vec3 sig = mix(uColorC, uColorA, uMix * 0.5);
      float burst = smoothstep(0.3, 0.0, abs(vDist - uBurstR)) * uBurstAmp;
      vec3 col = base * (0.055 + uActivity * 0.10) + sig * pulse * (0.55 + uActivity * 0.6) + uColorC * burst * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function inRegion(rand) {
    const r = rand();
    if (r < 0.80) return 'cerebrum';
    if (r < 0.94) return 'cerebellum';
    return 'stem';
  }

  /* Sample one point inside a brain-shaped volume. Returns THREE.Vector3-ish array. */
  function samplePoint() {
    const region = inRegion(Math.random);
    if (region === 'cerebrum') {
      let x, y, z, d;
      do {
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
        d = x * x + y * y + z * z;
      } while (d > 1 || d < 1e-6);
      d = Math.sqrt(d); x /= d; y /= d; z /= d;
      /* cortical wrinkles */
      const w = 1
        + 0.05 * Math.sin(6.0 * x + 3.0 * z)
        + 0.05 * Math.sin(5.0 * y + 7.0 * z + 1.7)
        + 0.04 * Math.sin(9.0 * x * y + 8.0 * z);
      /* bias samples toward the cortex surface */
      const shell = 0.55 + 0.45 * Math.pow(Math.random(), 0.4);
      let px = x * 0.95 * w * shell;
      let py = y * 0.80 * w * shell;
      let pz = z * 1.25 * w * shell;
      if (py < -0.48) py = -0.48 - (py + 0.48) * 0.3;           /* flatten base */
      if (Math.abs(px) < 0.045 && py > 0.1) px += px >= 0 ? 0.05 : -0.05; /* midline groove */
      return [px, py, pz];
    }
    if (region === 'cerebellum') {
      let x, y, z, d;
      do {
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
        d = x * x + y * y + z * z;
      } while (d > 1 || d < 1e-6);
      d = Math.sqrt(d); x /= d; y /= d; z /= d;
      const w = 1 + 0.07 * Math.sin(22.0 * y) + 0.03 * Math.sin(14.0 * x);
      const shell = 0.5 + 0.5 * Math.pow(Math.random(), 0.5);
      return [
        x * 0.52 * w * shell,
        -0.55 + y * 0.33 * w * shell,
        -0.95 + z * 0.42 * w * shell,
      ];
    }
    /* brain stem */
    const t = Math.random();
    const ang = Math.random() * Math.PI * 2;
    const rad = (0.14 - t * 0.05) * Math.sqrt(Math.random());
    return [
      Math.cos(ang) * rad,
      -0.5 - t * 0.5 + Math.sin(ang) * rad * 0.4,
      -0.55 + t * 0.22 + Math.sin(ang) * rad,
    ];
  }

  function buildEdges(positions, count, maxEdges) {
    const cell = 0.17;
    const maxD2 = 0.18 * 0.18;
    const grid = new Map();
    const key = (i, j, k) => i + '|' + j + '|' + k;
    for (let i = 0; i < count; i++) {
      const gx = Math.floor(positions[i * 3] / cell);
      const gy = Math.floor(positions[i * 3 + 1] / cell);
      const gz = Math.floor(positions[i * 3 + 2] / cell);
      const k = key(gx, gy, gz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const edges = [];
    const seen = new Set();
    for (let i = 0; i < count && edges.length < maxEdges; i++) {
      const gx = Math.floor(positions[i * 3] / cell);
      const gy = Math.floor(positions[i * 3 + 1] / cell);
      const gz = Math.floor(positions[i * 3 + 2] / cell);
      let linked = 0;
      for (let dx = -1; dx <= 1 && linked < 2; dx++)
        for (let dy = -1; dy <= 1 && linked < 2; dy++)
          for (let dz = -1; dz <= 1 && linked < 2; dz++) {
            const bucket = grid.get(key(gx + dx, gy + dy, gz + dz));
            if (!bucket) continue;
            for (const j of bucket) {
              if (j === i || linked >= 2) continue;
              const ex = positions[i * 3] - positions[j * 3];
              const ey = positions[i * 3 + 1] - positions[j * 3 + 1];
              const ez = positions[i * 3 + 2] - positions[j * 3 + 2];
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 > maxD2 || d2 < 1e-6) continue;
              const ek = i < j ? i + '-' + j : j + '-' + i;
              if (seen.has(ek)) continue;
              seen.add(ek);
              edges.push(i, j);
              linked++;
              if (edges.length / 2 >= maxEdges) return edges;
            }
          }
    }
    return edges;
  }

  function create(canvas, opts = {}) {
    const isMobile = opts.mobile;
    const governorOn = opts.governor !== false;
    const POINTS = isMobile ? 6000 : 12000;
    const MAX_EDGES = isMobile ? 4000 : 9000;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    let dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0.05, 3.6);

    const uniforms = {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uMix: { value: 0 },
      uBurstR: { value: 0 },
      uBurstAmp: { value: 0 },
      uPixelRatio: { value: dpr },
      uColorA: { value: new THREE.Color(0x34e0ff) },
      uColorB: { value: new THREE.Color(0xb26bff) },
      uColorC: { value: new THREE.Color(0x58ff9b) },
    };

    /* ── geometry ── */
    const positions = new Float32Array(POINTS * 3);
    const phases = new Float32Array(POINTS);
    const speeds = new Float32Array(POINTS);
    const sizes = new Float32Array(POINTS);
    const seeds = new Float32Array(POINTS);
    for (let i = 0; i < POINTS; i++) {
      const p = samplePoint();
      positions[i * 3] = p[0];
      positions[i * 3 + 1] = p[1];
      positions[i * 3 + 2] = p[2];
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.6 + Math.random() * 0.8;
      sizes[i] = 1.2 + Math.random() * 2.2;
      seeds[i] = Math.random();
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    pGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    pGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const pMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pGeo, pMat);

    const edgeIdx = buildEdges(positions, POINTS, MAX_EDGES);
    const edgeCount = edgeIdx.length / 2;
    const ePos = new Float32Array(edgeIdx.length * 3);
    const eT = new Float32Array(edgeIdx.length);
    const eSeed = new Float32Array(edgeIdx.length);
    for (let e = 0; e < edgeCount; e++) {
      const a = edgeIdx[e * 2], b = edgeIdx[e * 2 + 1];
      const s = Math.random();
      for (let k = 0; k < 3; k++) {
        ePos[(e * 2) * 3 + k] = positions[a * 3 + k];
        ePos[(e * 2 + 1) * 3 + k] = positions[b * 3 + k];
      }
      eT[e * 2] = 0; eT[e * 2 + 1] = 1;
      eSeed[e * 2] = s; eSeed[e * 2 + 1] = s;
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute('aT', new THREE.BufferAttribute(eT, 1));
    eGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 1));

    const eMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(eGeo, eMat);

    const group = new THREE.Group();
    group.add(lines);
    group.add(points);
    group.rotation.y = -0.55;
    scene.add(group);

    /* entrance */
    group.scale.setScalar(0.001);
    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 1.4, ease: 'elastic.out(1, 0.6)' });

    /* ── mouse parallax ── */
    let mx = 0, my = 0;
    function onPointer(e) {
      mx = (e.clientX / innerWidth) * 2 - 1;
      my = (e.clientY / innerHeight) * 2 - 1;
    }
    addEventListener('pointermove', onPointer, { passive: true });

    /* ── resize ── */
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize);
    resize();

    /* ── state transitions (GSAP) ── */
    let breathe = null;
    function think() {
      gsap.killTweensOf([uniforms.uActivity, uniforms.uMix]);
      gsap.to(uniforms.uActivity, { value: 1, duration: 0.5, ease: 'power2.out' });
      gsap.to(uniforms.uMix, { value: 1, duration: 0.6, ease: 'power2.out' });
      if (!breathe) {
        breathe = gsap.to(group.scale, {
          x: 1.045, y: 1.045, z: 1.045,
          duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut',
        });
      }
    }
    function idle() {
      gsap.killTweensOf([uniforms.uActivity, uniforms.uMix]);
      gsap.to(uniforms.uActivity, { value: 0, duration: 1.0, ease: 'power2.out' });
      gsap.to(uniforms.uMix, { value: 0, duration: 1.2, ease: 'power2.out' });
      if (breathe) { breathe.kill(); breathe = null; }
      gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'power2.out' });
    }
    function burst() {
      gsap.killTweensOf([uniforms.uBurstR, uniforms.uBurstAmp]);
      const tl = gsap.timeline();
      tl.set(uniforms.uBurstAmp, { value: 1 })
        .fromTo(uniforms.uBurstR, { value: 0 }, { value: 2.4, duration: 1.0, ease: 'power2.out' })
        .to(uniforms.uBurstAmp, { value: 0, duration: 0.4 }, '-=0.35')
        .set(uniforms.uBurstAmp, { value: 0.7 })
        .fromTo(uniforms.uBurstR, { value: 0 }, { value: 2.4, duration: 0.9, ease: 'power2.out' }, '-=0.1')
        .to(uniforms.uBurstAmp, { value: 0, duration: 0.4 }, '-=0.3');
    }

    /* ── render loop + FPS governor ── */
    let raf = 0;
    let dead = false;
    let frames = 0;
    let lastCheck = performance.now();
    let level = 0;

    function degrade() {
      level++;
      if (level === 1) { dpr = Math.min(dpr, 1.5); renderer.setPixelRatio(dpr); uniforms.uPixelRatio.value = dpr; resize(); }
      else if (level === 2) { dpr = 1; renderer.setPixelRatio(dpr); uniforms.uPixelRatio.value = dpr; resize(); }
      else if (level === 3) {
        pGeo.setDrawRange(0, Math.floor(POINTS * 0.55));
        eGeo.setDrawRange(0, Math.floor(edgeCount * 0.45) * 2);
      } else {
        destroy();
        if (opts.onFallback) opts.onFallback();
      }
    }

    function tick(now) {
      if (dead) return;
      raf = requestAnimationFrame(tick);
      const t = now * 0.001;
      uniforms.uTime.value = t;

      group.rotation.y = -0.55 + Math.sin(t * 0.12) * 0.18 + mx * 0.22;
      group.rotation.x = Math.sin(t * 0.09) * 0.05 + my * 0.12;

      renderer.render(scene, camera);

      if (governorOn) {
        frames++;
        if (frames > 90 && frames % 60 === 0) {
          const elapsed = now - lastCheck;
          const fps = 60000 / elapsed;
          lastCheck = now;
          if (fps < 22 && level >= 3) degrade();
          else if (fps < 45) degrade();
        } else if (frames % 60 === 0) {
          lastCheck = now;
        }
      }
    }
    raf = requestAnimationFrame(tick);

    function destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onPointer);
      removeEventListener('resize', resize);
      gsap.killTweensOf([uniforms.uActivity, uniforms.uMix, uniforms.uBurstR, uniforms.uBurstAmp, group.scale]);
      if (breathe) breathe.kill();
      pGeo.dispose(); eGeo.dispose(); pMat.dispose(); eMat.dispose();
      renderer.dispose();
    }

    return { think, idle, burst, destroy };
  }

  window.Brain3D = { create };
})();
