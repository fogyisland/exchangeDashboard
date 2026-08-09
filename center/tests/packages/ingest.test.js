import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { ingest } from '../../src/packages/ingest.js';
import { installer } from '../../src/packages/installer.js';

const HAS_MYSQL = !!process.env.TEST_MYSQL_URL;

function makeZip({ name, version = '1.0.0', extraCols = {} } = {}) {
  const manifest = {
    name, version, type: 'timeseries',
    database: { metricTable: 'demo_metrics', metricColumns: { agent_id: { type: 'varchar(64)', nullable: false }, ts: { type: 'datetime', nullable: false }, value: { type: 'int', nullable: true }, ...extraCols } }
  };
  const cols = Object.entries(manifest.database.metricColumns).map(([c, def]) => `${c} ${def.type.toUpperCase()} ${def.nullable === false ? 'NOT NULL' : 'NULL'}`).join(', ');
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  z.addFile('collector.js', Buffer.from(`export default { name: "${name}", async collect() { return { rows: [] }; } }`));
  z.addFile('migrations/001_initial.sql', Buffer.from(`CREATE TABLE demo_metrics (${cols})`));
  return z.toBuffer();
}

if (!HAS_MYSQL) {
  test('ingest (integration) skipped — set TEST_MYSQL_URL to enable', () => {});
} else {
  const { init, close } = await import('../../src/db/index.js');
  const dbKind = 'mysql';
  const db = await init({ dbKind, db: { host: process.env.TEST_MYSQL_HOST || 'localhost', port: 3306, user: 'root', password: '', database: 'exdashboard_test' } });
  const cacheRoot = '/tmp/pkg-ingest-' + Date.now();
  const fs = await import('node:fs/promises');
  await fs.mkdir(cacheRoot, { recursive: true });
  const logger = { info() {}, warn() {}, error() {} };
  const name = `ing-${Date.now()}`;
  await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: makeZip({ name }), logger });

  test('routeExtensions writes rows to pkg_<name>.<metricTable> and records a run', async () => {
    const capturedAt = new Date();
    const out = await ingest.routeExtensions({
      db, agentId: 'agent-x', capturedAt,
      extensions: [{ packageName: name, metricTable: 'demo_metrics', rows: [{ value: 42 }, { value: 17 }] }]
    });
    assert.equal(out[0].recorded, true);
    assert.equal(out[0].rowCount, 2);
    const rows = await db.query('SELECT * FROM ?? ORDER BY value', [`pkg_${name.replace(/-/g, '_')}.demo_metrics`]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].value, 17);
    assert.equal(rows[1].value, 42);
    assert.equal(rows[0].agent_id, 'agent-x');
    const runs = await db.query('SELECT * FROM package_runs WHERE package_name = ? AND status = ?', [name, 'recorded']);
    assert.ok(runs.length >= 1);
  });

  test('routeExtensions returns PKG_NOT_FOUND for unknown package', async () => {
    const out = await ingest.routeExtensions({ db, agentId: 'agent-x', capturedAt: new Date(), extensions: [{ packageName: 'nope-' + Date.now(), metricTable: 'demo_metrics', rows: [] }] });
    assert.match(out[0].error, /PKG_NOT_FOUND/);
  });

  test('routeExtensions silently skips disabled packages', async () => {
    await db.query('UPDATE packages SET enabled = 0 WHERE name = ?', [name]);
    const out = await ingest.routeExtensions({ db, agentId: 'agent-x', capturedAt: new Date(), extensions: [{ packageName: name, metricTable: 'demo_metrics', rows: [{ value: 99 }] }] });
    assert.equal(out[0].recorded, undefined, 'disabled package should be skipped (no recorded flag)');
    // Re-enable for cleanup
    await db.query('UPDATE packages SET enabled = 1 WHERE name = ?', [name]);
  });

  test('routeExtensions agent_id comes from server (not from package row)', async () => {
    await ingest.routeExtensions({ db, agentId: 'server-id-123', capturedAt: new Date(), extensions: [{ packageName: name, metricTable: 'demo_metrics', rows: [{ agent_id: 'SPOOFED', value: 5 }] }] });
    const rows = await db.query('SELECT agent_id FROM ?? WHERE value = ?', [`pkg_${name.replace(/-/g, '_')}.demo_metrics`, 5]);
    assert.equal(rows[0].agent_id, 'server-id-123', 'agent_id must come from server, not from package payload');
  });

  test('cleanup', async () => {
    await installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema: true, logger });
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await close(db);
  });
}
