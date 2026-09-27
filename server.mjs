import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

import { overview, details, resolveSpot } from './forecast.mjs';
const root = resolve(import.meta.dirname, 'dist');
const port = Number(process.env.PORT || 4317),
  // Bind loopback by default; set HENGELEN_HOST=0.0.0.0 (or HOST) when hosting
  // behind a platform router.
  bindHost = process.env.HENGELEN_HOST || process.env.HOST || '127.0.0.1',
  // Comma-separated hostnames the server answers to. Defaults preserve the
  // previous loopback-only behavior; set HENGELEN_ALLOWED_HOSTS to the public
  // hostname when hosting.
  allowedHosts = new Set(
    (process.env.HENGELEN_ALLOWED_HOSTS || `127.0.0.1:${port},localhost:${port}`)
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  );
const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  // Sent only when explicitly enabled: HSTS over plain HTTP would break local use.
  ...(process.env.HENGELEN_HSTS === '1'
    ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' }
    : {}),
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
};
function send(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders,
    ...headers,
  });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'Forbidden' });
    const url = new URL(req.url, 'http://' + req.headers.host),
      path = url.pathname;
    if (path.startsWith('/api/')) {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      if (path === '/api/overview') return send(res, 200, await overview());
      if (path === '/api/spot') {
        const spot = resolveSpot(url.searchParams.get('id'));
        if (!spot) return send(res, 404, { error: 'Spot not found' });
        return send(res, 200, await details(spot));
      }
      return send(res, 404, { error: 'Endpoint not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, { error: 'Method not allowed' });
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (!file.startsWith(root + '/')) return send(res, 403, { error: 'Forbidden' });
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...securityHeaders,
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    send(res, e.status || (e.code === 'ENOENT' ? 404 : 400), { error: e.message });
  }
});
server.listen(port, bindHost, () =>
  console.log(`Hengelen is ready at http://${bindHost}:${port}`),
);
