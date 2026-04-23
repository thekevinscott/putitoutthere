#!/usr/bin/env node
/**
 * Tiny static file server for the eval harness.
 *
 * Replaces `vitepress preview` (no access log) and `python3 -m http.server`
 * (no cleanUrls). Serves a directory tree with:
 *   - cleanUrls: /guide/concepts resolves to /guide/concepts.html
 *   - directory index: /guide/ resolves to /guide/index.html
 *   - optional base path prefix (e.g. /put-it-out-there/) that's stripped
 *     before filesystem lookup
 *   - one-line access log per request, to stdout
 *
 * Usage: docs-server.mjs <root-dir> <port> [base-path]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [,, rootArg, portArg, basePathArg = ''] = process.argv;
if (!rootArg || !portArg) {
  console.error('usage: docs-server.mjs <root-dir> <port> [base-path]');
  process.exit(2);
}
const root = rootArg;
const port = parseInt(portArg, 10);
const basePath = basePathArg.endsWith('/') ? basePathArg : basePathArg + (basePathArg ? '/' : '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml',
};

async function tryRead(absPath) {
  try { return await readFile(absPath); } catch { return null; }
}

function contentType(absPath) {
  return MIME[extname(absPath).toLowerCase()] || 'application/octet-stream';
}

function safeJoin(base, rel) {
  // Prevent path traversal. Normalize and ensure the result stays within base.
  const joined = normalize(join(base, rel));
  if (!joined.startsWith(normalize(base))) return null;
  return joined;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  let status = 200;
  let served = false;

  // Reject or strip base path
  if (basePath && basePath !== '/') {
    if (pathname === basePath.slice(0, -1)) {
      // redirect /base → /base/
      res.writeHead(301, { location: basePath });
      res.end();
      log(req, 301, Date.now() - started);
      return;
    }
    if (!pathname.startsWith(basePath)) {
      status = 404;
    } else {
      pathname = '/' + pathname.slice(basePath.length);
    }
  }

  if (status === 200) {
    const candidates = pathname.endsWith('/')
      ? [safeJoin(root, pathname + 'index.html')]
      : [
          safeJoin(root, pathname),
          safeJoin(root, pathname + '.html'),
          safeJoin(root, pathname + '/index.html'),
        ];

    for (const absPath of candidates) {
      if (!absPath) continue;
      const buf = await tryRead(absPath);
      if (buf) {
        res.writeHead(200, { 'content-type': contentType(absPath) });
        res.end(buf);
        served = true;
        break;
      }
    }
  }

  if (!served) {
    const fallback = safeJoin(root, '/404.html');
    const buf = fallback ? await tryRead(fallback) : null;
    if (buf) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found\n');
    }
  }

  log(req, res.statusCode, Date.now() - started);
});

// Sanitise the request URL before logging — CRLF in it would inject
// fake log entries, and ANSI escapes could poison a tail'd log.
function sanitiseForLog(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 512);
}

function log(req, status, ms) {
  const ts = new Date().toISOString();
  const method = sanitiseForLog(req.method);
  const url = sanitiseForLog(req.url);
  console.log(`${ts} ${method} ${url} → ${status} (${ms}ms)`);
}

server.listen(port, '127.0.0.1', () => {
  console.log(`docs-server: ${root} → http://127.0.0.1:${port}${basePath}`);
});
