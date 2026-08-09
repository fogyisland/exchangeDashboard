import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { installer } from '../../src/packages/installer.js';
import { PkgError } from '../../src/packages/errors.js';

const HAS_MYSQL = !!process.env.TEST_MYSQL_URL;

function makeZip({ name = 'demo-pkg', version = '1.0.0', extraCols = {}, extraMigrations = {} } = {}) {
  const manifest = {
    name,
    version,
    type: 'timeseries',
    database: {
      metricTable: 'demo_metrics',
      metricColumns: {
        agent_id: { type: 'varchar(64)', nullable: false },
        ts: { type: 'datetime', nullable: false },
        value: { type: 'int', nullable: true },
        ...extraCols
      }
    }
  };
  const cols = Object.entries(manifest.database.metricColumns).map(([c, def]) => {
    const word = def.type.toUpperCase().includes('VARCHAR') ? def.type.toUpperCase() : def.type.toUpperCase();
    const size = word.match(/\((\d+)\)/)?.[0] || '';
    return `${c} ${word.split('(')[0]}${size} ${def.nullable === false ? 'NOT NULL' : 'NULL'}`;
  }).join(', ');
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  z.addFile('collector.js', Buffer.from('export default { name: "' + name + '", async collect() { return { rows: [] }; } }'));
  z.addFile('migrations/001_initial.sql', Buffer.from(`CREATE TABLE demo_metrics (${cols})`));
  for (const [fn, content] of Object.entries(extraMigrations)) {
    z.addFile(`migrations/${fn}`, Buffer.from(content));
  }
  return z.toBuffer();
}

if (!HAS_MYSQL) {
  test('installer (integration) skipped — set TEST_MYSQL_URL to enable', () => {});
} else {
  const { init, close } = await import('../../src/db/index.js');
  const dbKind = 'mysql';
  const dbConfig = { host: process.env.TEST_MYSQL_HOST || 'localhost', port: Number(process.env.TEST_MYSQL_PORT) || 3306, user: process.env.TEST_MYSQL_USER || 'root', password: process.env.TEST_MYSQL_PASSWORD || '', database: process.env.TEST_MYSQL_DB || 'exdashboard_test' };
  const db = await init({ dbKind, db: dbConfig });
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-inst-'));
  const logger = { info() {}, warn() {}, error() {} };
  const name = `inst-${Date.now()}`;

  test('installPackage creates schema, tables, rows, and caches files', async () => {
    const buf = makeZip({ name });
    const r = await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger });
    assert.equal(r.name, name);
    assert.equal(r.version, '1.0.0');
    // Verify schema exists + table exists
    const tables = await db.query(`SHOW TABLES FROM \`pkg_${name.replace(/-/g, '_')}\``);
    assert.ok(tables.length >= 2, 'schema_migrations + demo_metrics tables should exist');
    // Verify registry row
    const pkgRow = await db.query('SELECT * FROM packages WHERE name = ?', [name]);
    assert.equal(pkgRow.length, 1);
    // Verify cache
    const cacheStat = await fs.stat(path.join(cacheRoot, name, 'current', 'manifest.json'));
    assert.ok(cacheStat);
  });

  test('installPackage blocks re-install of same version (PKG_REINSTALL_BLOCKED)', async () => {
    const buf = makeZip({ name });
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_REINSTALL_BLOCKED'
    );
  });

  test('installPackage blocks lower version (PKG_DOWNGRADE_NOT_ALLOWED)', async () => {
    const buf = makeZip({ name, version: '0.9.0' });
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_DOWNGRADE_NOT_ALLOWED'
    );
  });

  test('installPackage rejects DDL containing DROP (PKG_DDL_FORBIDDEN)', async () => {
    const evilName = `evil-${Date.now()}`;
    const buf = makeZip({ name: evilName, extraMigrations: { '002_drop.sql': 'DROP TABLE demo_metrics' } });
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_DDL_FORBIDDEN'
    );
    // Best-effort: schema should have been dropped. `SHOW DATABASES LIKE ?`
    // does not work through the prepared-statement protocol in MySQL, and
    // the value is a safe identifier we constructed ourselves, so interpolate it.
    const dbs = await db.query(`SHOW DATABASES LIKE 'pkg_${evilName.replace(/-/g, '_')}'`);
    assert.equal(dbs.length, 0, 'failed install must not leave a schema behind');
  });

  test('installPackage rejects schema mismatch (001_initial.sql columns != metricColumns)', async () => {
    const buf = makeZip({ name: `mismatch-${Date.now()}`, extraCols: { extra_col: { type: 'int', nullable: true } } });
    // Note: the ZIP builder above includes extraCols in the CREATE TABLE, so they match.
    // To force a mismatch, manipulate the manifest to claim fewer columns than the SQL creates.
    const manifest = JSON.parse(AdmZip(buf).getEntry('manifest.json').getData().toString('utf8'));
    delete manifest.database.metricColumns.extra_col;
    const z = new AdmZip();
    z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    z.addFile('collector.js', Buffer.from('export default {}'));
    z.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NULL, extra_col INT NULL)'));
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: z.toBuffer(), logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_SCHEMA_MISMATCH'
    );
  });

  test('uninstallPackage requires confirmDropSchema=true', async () => {
    await assert.rejects(
      installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema: false, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_CONFIRM_REQUIRED'
    );
  });

  test('uninstallPackage drops schema, removes registry rows, and cleans cache', async () => {
    const r = await installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema: true, logger });
    assert.equal(r.ok, true);
    // `SHOW DATABASES LIKE ?` does not work through the prepared-statement protocol in MySQL.
    // The value is a safe identifier we constructed ourselves, so interpolate it.
    const dbs = await db.query(`SHOW DATABASES LIKE 'pkg_${name.replace(/-/g, '_')}'`);
    assert.equal(dbs.length, 0, 'schema should be dropped');
    const pkgRows = await db.query('SELECT * FROM packages WHERE name = ?', [name]);
    assert.equal(pkgRows.length, 0, 'registry row removed');
    await assert.rejects(fs.stat(path.join(cacheRoot, name)), 'cache dir removed');
  });

  test('cleanup', async () => {
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await close(db);
  });
}