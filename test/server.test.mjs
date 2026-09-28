import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '',
      HENGELEN_HOST: '',
      HENGELEN_ALLOWED_HOSTS: '',
      HENGELEN_HSTS: '',
      PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  child.stderr.on('data', (c) => errors.push(c));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('server did not start: ' + Buffer.concat(errors).toString()));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('ready at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${Buffer.concat(errors).toString()}`));
    });
  });
  return { child, port };
}

async function stopServer(child) {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

function request(port, { path = '/', method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: host ? { host } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(env, fn) {
  const { child, port } = await startServer(env);
  try {
    return await fn(port);
  } finally {
    await stopServer(child);
  }
}

test('serves the atlas with security headers', async () => {
  await withServer({}, async (port) => {
    const res = await request(port, { path: '/' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.headers['content-security-policy']?.includes("frame-ancestors 'none'"));
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(res.headers['permissions-policy']?.includes('geolocation=()'));
    assert.equal(res.headers['strict-transport-security'], undefined);
  });
});

test('removed persistence endpoints are gone', async () => {
  await withServer({}, async (port) => {
    for (const path of ['/api/state', '/api/export', '/api/nope']) {
      const res = await request(port, { path });
      assert.equal(res.status, 404, path);
    }
  });
});

test('rejects unlisted hosts', async () => {
  await withServer({}, async (port) => {
    assert.equal((await request(port, { host: 'evil.example.com' })).status, 403);
    assert.equal((await request(port, { host: 'evil.example.com:9999' })).status, 403);
  });
});

test('default loopback allowlist accepts the Host header with its port', async () => {
  await withServer({}, async (port) => {
    // Browsers send `Host: 127.0.0.1:<port>` for non-default ports.
    const res = await request(port, { host: `127.0.0.1:${port}` });
    assert.equal(res.status, 200);
    assert.equal((await request(port, { host: 'localhost' })).status, 200);
  });
});

test('honors HENGELEN_ALLOWED_HOSTS and ignores ports when matching', async () => {
  await withServer({ HENGELEN_ALLOWED_HOSTS: 'example.com' }, async (port) => {
    assert.equal((await request(port, { host: 'example.com' })).status, 200);
    assert.equal((await request(port, { host: 'example.com:8443' })).status, 200);
    assert.equal((await request(port, { host: 'other.com' })).status, 403);
  });
});

test('rejects non-GET API methods and non-GET/HEAD static requests', async () => {
  await withServer({}, async (port) => {
    assert.equal((await request(port, { path: '/api/overview', method: 'PUT' })).status, 405);
    assert.equal((await request(port, { path: '/', method: 'POST' })).status, 405);
    assert.equal((await request(port, { path: '/', method: 'HEAD' })).status, 200);
  });
});

test('sends HSTS only when explicitly enabled', async () => {
  await withServer({ HENGELEN_HSTS: '1' }, async (port) => {
    const res = await request(port, { path: '/' });
    assert.equal(res.status, 200);
    assert.match(res.headers['strict-transport-security'], /max-age=\d+/);
  });
});

test('refuses to start without a built client', async () => {
  const index = new URL('../dist/index.html', import.meta.url);
  const hidden = new URL('../dist/index.html.missing-dist-check', import.meta.url);
  await rename(index, hidden);
  try {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: String(await freePort()) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const [code, stderr] = await new Promise((resolve) => {
      const chunks = [];
      child.stderr.on('data', (c) => chunks.push(c));
      child.on('exit', (c) => resolve([c, Buffer.concat(chunks).toString()]));
    });
    assert.equal(code, 1);
    assert.match(stderr, /npm run build/);
  } finally {
    await rename(hidden, index);
  }
});
