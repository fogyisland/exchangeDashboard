import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { buildServerApps } from '../server.js';

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

