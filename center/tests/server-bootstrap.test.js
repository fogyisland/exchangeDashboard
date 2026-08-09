import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { buildServerApps } from '../server.js';
import { hasMarker, writeMarker } from '../src/init/marker.js';

// Use a real pino logger (with .child()) because createApp wires
// pino-http({logger}) which calls prevLogger.child() on every request.
function makeLogger() {
  return pino({ level: 'silent' });
}

const fakeConfig = (overrides = {}) => ({
  listenPort: 8080,
  heartbeatPort: 8081,
  reportPort: 8082,
  jwt: { secret: 'test-secret' },
  agent: { heartbeatStaleSeconds: 90 },
  ...overrides
});
const fakeDb = { query: async () => [], execute: async () => ({ rows: [] }) };

test('buildServerApps returns {webApp, heartbeatApp, reportApp, ports}', () => {
  const out = buildServerApps({
    config: fakeConfig(),
    db: fakeDb,
    logger: makeLogger(),
    needsInit: false,
    systemConfig: {}
  });
  assert.ok(out, 'buildServerApps must return a value');
  assert.ok(out.webApp, 'webApp missing');
  assert.ok(out.heartbeatApp, 'heartbeatApp missing');
  assert.ok(out.reportApp, 'reportApp missing');
  assert.ok(out.ports, 'ports missing');
  assert.equal(typeof out.webApp, 'function');
  assert.equal(typeof out.heartbeatApp, 'function');
  assert.equal(typeof out.reportApp, 'function');
  assert.equal(out.ports.web, 8080);
  assert.equal(out.ports.heartbeat, 8081);
  assert.equal(out.ports.report, 8082);
});

test('buildServerApps uses config.listenPort for the web port', () => {
  const out = buildServerApps({
    config: fakeConfig({ listenPort: 9000 }),
    db: fakeDb,
    logger: makeLogger(),
    needsInit: true,
    systemConfig: {}
  });
  assert.equal(out.ports.web, 9000);
});

test('buildServerApps: heartbeatApp and reportApp accept HTTP requests', async () => {
  const out = buildServerApps({
    config: fakeConfig(),
    db: fakeDb,
    logger: makeLogger(),
    needsInit: false,
    systemConfig: {}
  });
  // Express populates _router lazily on the first incoming request. Use
  // supertest-style helpers via a tiny inline http listener so we don't
  // need supertest as a dependency for this single check.
  const http = await import('node:http');
  function probe(app) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(app);
      srv.listen(0, () => {
        const port = srv.address().port;
        const req = http.request({ method: 'GET', host: '127.0.0.1', port, path: '/healthz' }, (res) => {
          res.resume();
          srv.close(() => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });
    });
  }
  const heartbeatStatus = await probe(out.heartbeatApp);
  const reportStatus = await probe(out.reportApp);
  assert.equal(heartbeatStatus, 200);
  assert.equal(reportStatus, 200);
});

// --- Blockers 1 & 2: ESM-fs and registry-marker tests ----------------------

test('center/server.js does NOT use CommonJS require() — ESM-only', async () => {
  // Blockers 1: require('node:fs') inside server.js throws ReferenceError
  // under "type": "module". Read the source and assert no `require(` token
  // appears (comments are OK — they don't execute). This is a static check
  // that survives refactors as long as server.js stays ESM-only.
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.resolve(here, '..', 'server.js');
  const src = await fs.readFile(serverPath, 'utf8');
  // Strip line comments and block comments so a comment like
  // `// see require() docs` doesn't trip the check.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    stripped,
    /\brequire\s*\(/,
    'server.js must not contain CommonJS require(); use ESM imports only'
  );
});

test('hasMarker accepts an injected _checkRegistry function (dependency injection)', () => {
  // The new hasMarker contract: signature is
  //   hasMarker({ configPath, _checkRegistry })
  // where _checkRegistry() returns true if the Windows registry key is
  // present (REG_DWORD 0x1). When omitted, hasMarker falls back to the
  // existing .env-only check (preserves non-Windows behavior).
  // Just verifying the function is callable with the extra field — no
  // assertion on platform behavior here, only that the signature accepts it.
  assert.equal(typeof hasMarker, 'function');
  // Calling without _checkRegistry must not throw (non-Windows path).
  // Use a config path that surely has no .env file so the result is `false`.
  const result = hasMarker({
    configPath: path.join(os.tmpdir(), 'definitely-not-exists-' + Date.now() + '.json'),
    _checkRegistry: () => false
  });
  assert.equal(result, false);
});

test('hasMarker returns true when _checkRegistry returns true (Windows marker)', () => {
  // Simulate the Windows registry hit by injecting a checker that returns
  // true. Even without a .env file, hasMarker must report true.
  const result = hasMarker({
    configPath: path.join(os.tmpdir(), 'no-env-here-' + Date.now() + '.json'),
    _checkRegistry: () => true
  });
  assert.equal(result, true, 'hasMarker must honor the injected registry check');
});

test('hasMarker returns false when .env missing AND _checkRegistry returns false', () => {
  const result = hasMarker({
    configPath: path.join(os.tmpdir(), 'still-missing-' + Date.now() + '.json'),
    _checkRegistry: () => false
  });
  assert.equal(result, false);
});

test('writeMarker + hasMarker round-trip works with injected registry stub', async () => {
  // On non-Windows or in test, the registry write in writeMarker is a
  // no-op (it short-circuits when process.platform !== 'win32'). So the
  // injected _checkRegistry must be the path the test exercises.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-rr-'));
  const cfg = path.join(dir, 'appsettings.json');
  await fs.writeFile(cfg, '{}');
  await writeMarker({ configPath: cfg });
  assert.equal(hasMarker({ configPath: cfg, _checkRegistry: () => false }), true);
});