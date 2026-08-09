import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedPackages, packageRuns, packageVersions } from '../../src/packages/sql.js';

const HAS_MYSQL = !!process.env.TEST_MYSQL_URL;

if (!HAS_MYSQL) {
  test('sql helpers (integration) skipped — set TEST_MYSQL_URL to enable', () => {});
} else {
  // Lazily import the driver + ajv only when running integration tests.
  const { init, close } = await import('../../src/db/index.js');
  const db = await init({ dbKind: 'mysql', db: { host: process.env.TEST_MYSQL_HOST || 'localhost', port: Number(process.env.TEST_MYSQL_PORT) || 3306, user: process.env.TEST_MYSQL_USER || 'root', password: process.env.TEST_MYSQL_PASSWORD || '', database: process.env.TEST_MYSQL_DB || 'exdashboard_test' } });
  test.after(async () => { await close(db); });

  test('installedPackages.upsert + get round-trip', async () => {
    const name = `sql-upsert-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'timeseries', manifest: { foo: 1 }, enabled: 1, installedAt: new Date() });
    const r = await installedPackages.get(db, name);
    assert.ok(r);
    assert.equal(r.name, name);
    assert.equal(r.type, 'timeseries');
    assert.deepEqual(r.manifest, { foo: 1 });
    assert.equal(r.enabled, 1);
  });

  test('installedPackages.get returns null for missing package', async () => {
    const r = await installedPackages.get(db, 'does-not-exist-' + Date.now());
    assert.equal(r, null);
  });

  test('installedPackages.list returns all packages', async () => {
    const name = `sql-list-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'gauge', manifest: {}, enabled: 1, installedAt: new Date() });
    const list = await installedPackages.list(db);
    const found = list.find((p) => p.name === name);
    assert.ok(found);
  });

  test('installedPackages.delete removes the package row', async () => {
    const name = `sql-delete-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'timeseries', manifest: {}, enabled: 1, installedAt: new Date() });
    await installedPackages.delete(db, name);
    const r = await installedPackages.get(db, name);
    assert.equal(r, null);
  });

  test('packageRuns.record inserts a run row', async () => {
    const name = `sql-runs-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'timeseries', manifest: {}, enabled: 1, installedAt: new Date() });
    await packageRuns.record(db, { packageName: name, ts: new Date(), status: 'installed', output: { rows: 0 } });
    const r = await db.query('SELECT * FROM package_runs WHERE package_name = ? ORDER BY id DESC LIMIT 1', [name]);
    assert.equal(r[0].status, 'installed');
    assert.equal(r[0].package_name, name);
  });

  test('packageVersions.upsert + delete round-trip', async () => {
    const name = `sql-versions-${Date.now()}`;
    await packageVersions.upsert(db, { packageName: name, version: '1.0.0', installedAt: new Date() });
    const rows = await db.query('SELECT * FROM package_versions WHERE package_name = ?', [name]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, '1.0.0');
    await packageVersions.delete(db, name);
    const after = await db.query('SELECT * FROM package_versions WHERE package_name = ?', [name]);
    assert.equal(after.length, 0);
  });
}