import crypto from 'node:crypto';
import path from 'node:path';
import { testDbConnection } from './db-tester.js';
import { applySchema } from './schema-applier.js';
import { createAdminUser } from './admin-creator.js';
import { writeConfig } from './config-writer.js';
import { writeMarker } from './marker.js';
import { loadOrCreateKey, encryptString } from '../config-crypto.js';

export async function wizardFacade({ dbKind, db: dbConfig, admin, installPath, configPath }) {
  const tested = await testDbConnection(dbKind, dbConfig);
  if (!tested.ok) return { ok: false, stage: 'test-db', error: tested.error };

  const { init } = await import('../db/index.js');
  const ctx = await init({ dbKind, db: dbConfig });
  try {
    await applySchema(ctx, dbKind);
    await createAdminUser(ctx, admin);
  } finally {
    await ctx.close();
  }

  const envPath = path.join(path.dirname(configPath), '.env');
  const { key } = loadOrCreateKey(envPath);

  const config = {
    listenPort: 8080,
    heartbeatPort: 8081,
    reportPort: 8082,
    logLevel: 'info',
    installPath,
    dbKind,
    db: { ...dbConfig, password: encryptString(dbConfig.password || '', key) },
    jwt: {
      secret: encryptString(crypto.randomBytes(32).toString('hex'), key),
      expiresInSeconds: 28800
    },
    agent: { heartbeatStaleSeconds: 90, queueRetentionDays: 7, mdbCopyRetentionDays: 7, serviceStateRetentionDays: 30 }
  };
  writeConfig(configPath, config);
  writeMarker({ configPath });

  return { ok: true, exit: true };
}

let closed = false;
export function closeWizardFacade() { closed = true; }
export function isClosed() { return closed; }