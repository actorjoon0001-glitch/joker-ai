/* Boot — choose 3D (WebGL) or 2D fallback brain, wire the chat to a facade that
   survives a mid-session 3D → 2D swap. Query params: ?mode=2d|3d, ?gov=0 (disable
   the FPS governor, for testing). */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const forced = params.get('mode');
  const governor = params.get('gov') !== '0';
  const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 700;

  const canvas3d = document.getElementById('brain3d');
  const canvas2d = document.getElementById('brain2d');
  const capMode = document.getElementById('capMode');

  /* WebGL must exist AND be hardware-accelerated — software rasterizers
     (SwiftShader/llvmpipe) crawl at 12k particles, so send those straight to 2D. */
  function webglOK() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        if (/swiftshader|llvmpipe|software/i.test(renderer)) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Facade so chat.js keeps a stable reference across a 3D→2D fallback swap */
  const Brain = {
    impl: null,
    think() { this.impl && this.impl.think(); },
    idle() { this.impl && this.impl.idle(); },
    burst() { this.impl && this.impl.burst(); },
  };

  function boot2D() {
    canvas3d.hidden = true;
    canvas2d.hidden = false;
    capMode.textContent = 'Canvas';
    Brain.impl = Brain2D.create(canvas2d);
  }

  function boot3D() {
    canvas2d.hidden = true;
    canvas3d.hidden = false;
    capMode.textContent = isMobile ? 'GPU · Lite' : 'GPU';
    Brain.impl = Brain3D.create(canvas3d, {
      mobile: isMobile,
      governor,
      onFallback() {
        console.info('[joker] FPS governor: falling back to 2D brain');
        Brain.impl = null;
        boot2D();
      },
    });
  }

  const use3D = forced === '3d' || (forced !== '2d' && typeof THREE !== 'undefined' && webglOK());
  if (use3D) boot3D();
  else boot2D();

  JokerChat.init(Brain);
})();
