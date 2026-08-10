import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadConfigOrNull } from '../../src/config.js';
import { encryptString, loadOrCreateKey } from '../../src/config-crypto.js';
import { writeConfig } from '../../src/init/config-writer.js';

const KEY = 'c'.repeat(64);

async function freshDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'lm-'));
}

async function writeConfigFile(dir, cfg) {
  const configPath = path.join(dir, 'appsettings.json');
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2));
  return configPath;
}

async function writeEnv(dir, body) {
  const envPath = path.join(dir, '.env');
  await fs.writeFile(envPath, body);
  return envPath;
}

test('loadConfigOrNull returns needsMigration=true for plaintext install with no .env key', async () => {
  const dir = await freshDir();
  const cfgPath = await writeConfigFile(dir, {
    listenPort: 8080,
    db: { host: 'h', user: 'u', password: 'plain-pw', database: 'd' },
    jwt: { secret: 'plain-jwt' }
  });
  const r = await loadConfigOrNull(cfgPath);
  assert.equal(r.config.db.password, 'plain-pw');
  assert.equal(r.config.jwt.secret, 'plain-jwt');
  assert.equal(r.needsMigration, true);
});

test('loadConfigOrNull throws SECRET_KEY_MISMATCH when secrets are encrypted but .env has no key', async () => {
  const dir = await freshDir();
  const cfgPath = await writeConfigFile(dir, {
    listenPort: 8080,
    db: { host: 'h', user: 'u', password: encryptString('real-pw', KEY), database: 'd' },
    jwt: { secret: encryptString('real-jwt', KEY) }
  });
  await assert.rejects(
    () => loadConfigOrNull(cfgPath),
    /SECRET_KEY_MISMATCH/
  );
});

test('loadConfigOrNull returns decrypted config + needsMigration=true for plaintext install', async () => {
  const dir = await freshDir();
  await writeEnv(dir, `EXDASHBOARD_SECRET_KEY=${KEY}\n`);
  const cfgPath = await writeConfigFile(dir, {
    db: { host: 'h', user: 'u', password: 'plain-pw', database: 'd' },
    jwt: { secret: 'plain-jwt' }
  });
  const r = await loadConfigOrNull(cfgPath);
  assert.equal(r.config.db.password, 'plain-pw');
  assert.equal(r.config.jwt.secret, 'plain-jwt');
  assert.equal(r.needsMigration, true);
});

test('loadConfigOrNull returns decrypted config + needsMigration=false for already-encrypted install', async () => {
  const dir = await freshDir();
  await writeEnv(dir, `EXDASHBOARD_SECRET_KEY=${KEY}\n`);
  const cfgPath = await writeConfigFile(dir, {
    db: { host: 'h', user: 'u', password: encryptString('real-pw', KEY), database: 'd' },
    jwt: { secret: encryptString('real-jwt', KEY) }
  });
  const r = await loadConfigOrNull(cfgPath);
  assert.equal(r.config.db.password, 'real-pw');
  assert.equal(r.config.jwt.secret, 'real-jwt');
  assert.equal(r.needsMigration, false);
});

test('loadConfigOrNull returns null when appsettings.json is missing', async () => {
  const dir = await freshDir();
  const r = await loadConfigOrNull(path.join(dir, 'no-such-file.json'));
  assert.equal(r, null);
});

test('loadConfigOrNull throws on tampered encrypted value', async () => {
  const dir = await freshDir();
  await writeEnv(dir, `EXDASHBOARD_SECRET_KEY=${KEY}\n`);
  const valid = encryptString('x', KEY);
  const parts = valid.split(':');
  parts[3] = parts[3].slice(0, -1) + (parts[3].slice(-1) === '0' ? '1' : '0');
  const tampered = parts.join(':');
  const cfgPath = await writeConfigFile(dir, {
    db: { host: 'h', user: 'u', password: tampered, database: 'd' },
    jwt: { secret: 'plain' }
  });
  await assert.rejects(() => loadConfigOrNull(cfgPath), /SECRET_KEY_MISMATCH/);
});

test('loadConfigOrNull throws SECRET_KEY_MISMATCH when encrypted secrets are encrypted with a different key than .env holds', async () => {
  const dir = await freshDir();
  await writeEnv(dir, `EXDASHBOARD_SECRET_KEY=${KEY}\n`);
  const cfgPath = await writeConfigFile(dir, {
    listenPort: 8080,
    db: { host: 'h', user: 'u', password: encryptString('real-pw', 'd'.repeat(64)), database: 'd' },
    jwt: { secret: encryptString('real-jwt', 'd'.repeat(64)) }
  });
  await assert.rejects(
    () => loadConfigOrNull(cfgPath),
    /SECRET_KEY_MISMATCH/
  );
});

test('migration: plaintext appsettings.json → call migrate → encrypted on disk → re-load decrypts', async () => {
  const dir = await freshDir();
  await writeEnv(dir, `EXDASHBOARD_SECRET_KEY=${KEY}\n`);
  const cfgPath = await writeConfigFile(dir, {
    listenPort: 8080,
    db: { host: 'h', user: 'u', password: 'plain-pw', database: 'd' },
    jwt: { secret: 'plain-jwt', expiresInSeconds: 28800 }
  });

  // Inline the migration logic so the test does not depend on server.js.
  // (server-bootstrap tests cover that path; this test covers the round-trip.)
  const envPath = path.join(dir, '.env');
  const { key } = loadOrCreateKey(envPath);
  const before = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
  const next = { ...before };
  for (const [obj, field] of [['db', 'password'], ['jwt', 'secret']]) {
    const v = next[obj][field];
    if (typeof v === 'string' && !v.startsWith('enc:v1:')) {
      next[obj] = { ...next[obj], [field]: encryptString(v, key) };
    }
  }
  await writeConfig(cfgPath, next);

  const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
  assert.match(onDisk.db.password, /^enc:v1:/);
  assert.match(onDisk.jwt.secret, /^enc:v1:/);

  const r = await loadConfigOrNull(cfgPath);
  assert.equal(r.config.db.password, 'plain-pw');
  assert.equal(r.config.jwt.secret, 'plain-jwt');
  assert.equal(r.needsMigration, false);
});
