import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyPendingMigrations, getCurrentVersion } from '../../src/services/migrations.js';

function fakeDb() {
  const applied = [];
  return {
    applied,
    async query(sql, params) {
      if (/INSERT INTO schema_migrations/.test(sql)) {
        applied.push(params[0]);
        return [];
      }
      if (/SELECT version FROM schema_migrations/.test(sql)) {
        if (/ORDER BY version DESC/.test(sql)) {
          return applied.slice().reverse().map((v) => ({ version: v }));
        }
        return applied.map((v) => ({ version: v }));
      }
      return [];
    }
  };
}

test('applyPendingMigrations applies new files in order', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mig-'));
  await fs.writeFile(path.join(dir, '001-a.sql'), 'CREATE TABLE a (id INT);');
  await fs.writeFile(path.join(dir, '002-b.sql'), 'CREATE TABLE b (id INT);');
  const db = fakeDb();
  await applyPendingMigrations(db, dir);
  assert.equal(await getCurrentVersion(db), '002-b');
  assert.deepEqual(db.applied, ['001-a', '002-b']);
});