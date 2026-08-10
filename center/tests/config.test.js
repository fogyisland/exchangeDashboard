import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadConfigOrNull, defaultConfig, sha256Hex, getListenPort } from '../src/config.js';

test('defaultConfig returns sensible defaults', () => {
  const c = defaultConfig();
  assert.equal(c.listenPort, 8080);
  assert.equal(c.heartbeatPort, 8081);
  assert.equal(c.reportPort, 8082);
  assert.equal(c.dbKind, 'mysql');
});

test('sha256Hex of known input', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('getListenPort returns explicit value', () => {
  assert.equal(getListenPort({ listenPort: 9090 }), 9090);
});

test('loadConfigOrNull returns null when file missing', async () => {
  const r = await loadConfigOrNull(path.join(os.tmpdir(), 'no-such-' + Date.now() + '.json'));
  assert.equal(r, null);
});

test('loadConfigOrNull parses a real file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'excfg-'));
  const file = path.join(dir, 'appsettings.json');
  await fs.writeFile(file, JSON.stringify({ listenPort: 7777, dbKind: 'mssql' }));
  // loadConfigOrNull now requires a sibling .env with EXDASHBOARD_SECRET_KEY.
  // See tasks 1-3 of the config-secret-encryption SDD.
  await fs.writeFile(path.join(dir, '.env'), `EXDASHBOARD_SECRET_KEY=${'c'.repeat(64)}\n`);
  const r = await loadConfigOrNull(file);
  assert.ok(r);
  assert.equal(r.config.listenPort, 7777);
  assert.equal(r.config.dbKind, 'mssql');
  assert.ok(r.installPath);
});
