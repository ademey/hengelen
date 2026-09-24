import http from 'node:http';
import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { presets } from './src/spots.js';
import { validateState } from './src/domain.js';
import { overview, details, resolveSpot } from './forecast.mjs';
const root = resolve(import.meta.dirname, 'dist'),
  dataDir = resolve(process.env.HENGELEN_DATA_DIR || resolve(import.meta.dirname, 'data')),
  stateFile = resolve(dataDir, 'state.json');
const port = Number(process.env.PORT || 4317),
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const defaults = { revision: 0, spots: [], entries: [], prefs: { windLimit: 10 } };
async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return structuredClone(defaults);
    throw Error('Local data could not be read. Your file has not been changed.');
  }
}
let writes = Promise.resolve();
function writeState(input) {
  const op = writes
    .catch(() => {})
    .then(async () => {
      const old = await readState();
      if (input.revision !== old.revision) {
        const e = Error('Data changed in another window. Reload before saving again.');
        e.status = 409;
        throw e;
      }
      const clean = validateState(input);
      if (clean.spots.some((s) => !presets.some((p) => p.id === s.referenceId)))
        throw Error('Unknown reference area');
      const next = { ...clean, revision: old.revision + 1, savedAt: new Date().toISOString() };
      await mkdir(dataDir, { recursive: true });
      if (old.revision > 0) await copyFile(stateFile, stateFile + '.bak');
      await writeFile(stateFile + '.tmp', JSON.stringify(next, null, 2));
      await rename(stateFile + '.tmp', stateFile);
      return next;
    });
  writes = op;
  return op;
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 2_000_000) {
      const e = Error('Request too large');
      e.status = 413;
      throw e;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Error('Invalid JSON');
  }
}
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
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host))
      return send(res, 403, { error: 'Local requests only' });
    if (
      req.headers.origin &&
      !['http://127.0.0.1:' + port, 'http://localhost:' + port].includes(req.headers.origin)
    )
      return send(res, 403, { error: 'Cross-origin requests are not allowed' });
    const url = new URL(req.url, 'http://' + req.headers.host),
      path = url.pathname;
    if (path.startsWith('/api/')) {
      if (path === '/api/state' && req.method === 'GET') return send(res, 200, await readState());
      if (path === '/api/state' && req.method === 'PUT') {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(res, 415, { error: 'JSON required' });
        return send(res, 200, await writeState(await body(req)));
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      if (path === '/api/overview') return send(res, 200, await overview());
      if (path === '/api/spot') {
        const spot = resolveSpot(url.searchParams.get('id'), await readState());
        if (!spot) return send(res, 404, { error: 'Spot not found' });
        return send(res, 200, await details(spot));
      }
      if (path === '/api/export')
        return send(res, 200, await readState(), {
          'Content-Disposition': 'attachment; filename="hengelen-backup.json"',
        });
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
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    send(res, e.status || (e.code === 'ENOENT' ? 404 : 400), { error: e.message });
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Hengelen is ready at http://127.0.0.1:${port}`),
);
