/* Local dev server: serves the static site and mounts api/chat.js at /api/chat
   with the same (req, res) shape it gets on Vercel.
   Usage: ANTHROPIC_API_KEY=sk-... node server.js  →  http://localhost:3000 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chatHandler from './api/chat.js';
import memoryHandler from './api/memory.js';
import historyHandler from './api/history.js';

const API_ROUTES = {
  '/api/chat': chatHandler,
  '/api/memory': memoryHandler,
  '/api/history': historyHandler,
};

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 8e6) { reject(new Error('body_too_large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* Minimal shims for the Vercel-style res.status().json() helpers the handler uses */
function extendRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const apiHandler = API_ROUTES[url.pathname];
  if (apiHandler) {
    try {
      const raw = await readBody(req);
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      req.body = {};
    }
    req.query = Object.fromEntries(url.searchParams);
    await apiHandler(req, extendRes(res));
    return;
  }

  /* static files */
  let filePath = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Joker is listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('warning: ANTHROPIC_API_KEY is not set — /api/chat will fail until it is.');
  }
});
