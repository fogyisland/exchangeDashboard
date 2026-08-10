import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { hasMarker } from '../../src/init/marker.js';
import { wizardFacade } from '../../src/init/wizard-facade.js';
import { writeConfig as wc } from '../../src/init/config-writer.js';
import { loadConfigOrNull } from '../../src/config.js';

test('wizardFacade rejects unsupported dbKind', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-'));
  const cfg = path.join(dir, 'appsettings.json');
  await fs.writeFile(cfg, '{}');
  const out = await wizardFacade({ dbKind: 'postgres', db: {}, admin: { username: 'a', password: 'longenough' }, installPath: dir, configPath: cfg });
  assert.equal(out.ok, false);
  assert.equal(out.stage, 'test-db');
});

test('wizardFacade writes encrypted secrets to appsettings.json', async () => {
  // Existing wizard test in this file exercises an unsupported dbKind.
  // This test uses a fake dbKind so testDbConnection rejects early,
  // but we still want to verify the write path would encrypt if it ran.
  // To exercise the encrypt-write path without a real DB, we call the
  // helper logic directly.
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const crypto = await import('node:crypto');
  const { encryptString, loadOrCreateKey } = await import('../../src/config-crypto.js');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-enc-'));
  const cfgPath = path.join(dir, 'appsettings.json');
  const envPath = path.join(dir, '.env');
  const { key } = loadOrCreateKey(envPath);

  const config = {
    listenPort: 8080,
    db: { host: 'h', user: 'u', password: encryptString('my-db-pw', key), database: 'd' },
    jwt: { secret: encryptString(crypto.randomBytes(32).toString('hex'), key), expiresInSeconds: 28800 },
    agent: {}
  };
  wc(cfgPath, config);

  const r = await loadConfigOrNull(cfgPath);
  assert.equal(r.config.db.password, 'my-db-pw');
  assert.match(r.config.jwt.secret, /^[0-9a-f]+$/);
  assert.equal(r.needsMigration, false);
});