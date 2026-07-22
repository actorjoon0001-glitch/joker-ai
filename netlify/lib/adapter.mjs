/* Adapts our Vercel-style (req, res) handlers to Netlify Functions 2.0
   (web-standard Request → Response), including streamed bodies: the Response
   is returned as soon as the handler writes its first chunk, and the rest is
   piped through a ReadableStream. */

export function wrapVercelHandler(handler) {
  return async (request) => {
    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try { body = await request.json(); } catch {}
    }
    const url = new URL(request.url);

    const headers = {};
    const encoder = new TextEncoder();
    let controller;
    let started = false;
    let startResolve;
    const startedP = new Promise((r) => { startResolve = r; });
    const stream = new ReadableStream({ start(c) { controller = c; } });

    const res = {
      statusCode: 200,
      setHeader(k, v) { headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      write(chunk) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
        if (!started) { started = true; startResolve(); }
        return true;
      },
      end(chunk) {
        if (chunk) this.write(chunk);
        try { controller.close(); } catch {}
        if (!started) { started = true; startResolve(); }
      },
      json(obj) {
        this.setHeader('Content-Type', 'application/json');
        this.write(JSON.stringify(obj));
        this.end();
      },
    };

    const req = {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      query: Object.fromEntries(url.searchParams),
    };

    const running = Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => {
        console.error('[netlify adapter]', err);
        if (!started) {
          res.statusCode = 500;
          res.json({ error: 'internal_error' });
        } else {
          try { controller.close(); } catch {}
        }
      });

    /* safety: a handler that returns without writing must still close the stream */
    running.then(() => { if (!started) { try { controller.close(); } catch {} } });

    await Promise.race([startedP, running]);
    return new Response(stream, { status: res.statusCode, headers });
  };
}
