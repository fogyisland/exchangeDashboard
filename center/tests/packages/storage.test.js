import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { parseZip, cachePackage, removeCache } from '../../src/packages/storage.js';
import { PkgError } from '../../src/packages/errors.js';

function makeManifest() {
  return {
    name: 'demo-pkg',
    version: '1.0.0',
    type: 'timeseries',
    database: {
      metricTable: 'demo_metrics',
      metricColumns: {
        agent_id: { type: 'varchar(64)', nullable: false },
        ts: { type: 'datetime', nullable: false },
        value: { type: 'int', nullable: true }
      }
    }
  };
}

function makeZip({ manifest = makeManifest(), collectorJs = 'export default { name: "demo-pkg", async collect() { return { rows: [] }; } }', migrations = { '001_initial.sql': 'CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NULL)' } } = {}) {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  z.addFile('collector.js', Buffer.from(collectorJs));
  for (const [filename, content] of Object.entries(migrations)) {
    z.addFile(`migrations/${filename}`, Buffer.from(content));
  }
  return z.toBuffer();
}

test('parseZip extracts manifest, collector, and migrations in lexical order', async () => {
  const buf = makeZip({ migrations: { '002_add.sql': 'ALTER TABLE demo_metrics ADD COLUMN extra INT', '001_initial.sql': 'CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL)' } });
  const r = parseZip(buf);
  assert.equal(r.manifest.name, 'demo-pkg');
  assert.match(r.collectorJs, /export default/);
  assert.equal(r.migrations.length, 2);
  assert.equal(r.migrations[0].filename, '001_initial.sql');
  assert.equal(r.migrations[1].filename, '002_add.sql');
  assert.match(r.migrations[1].content, /ALTER TABLE/);
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) on non-zip buffer', () => {
  assert.throws(() => parseZip(Buffer.from('not a zip')), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) when manifest.json missing', () => {
  const z = new AdmZip();
  z.addFile('collector.js', Buffer.from('export default {}'));
  assert.throws(() => parseZip(z.toBuffer()), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) when collector.js missing', () => {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(makeManifest())));
  z.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL)'));
  assert.throws(() => parseZip(z.toBuffer()), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) when migrations dir empty', () => {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(makeManifest())));
  z.addFile('collector.js', Buffer.from('export default {}'));
  assert.throws(() => parseZip(z.toBuffer()), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('cachePackage writes files to <cacheRoot>/<name>/<version>/ and creates junction', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-cache-'));
  const buf = makeZip();
  const parsed = parseZip(buf);
  const r = await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.0.0', ...parsed });
  assert.equal(r.cachePath, path.join(cacheRoot, 'demo-pkg', 'current'));
  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.name, 'demo-pkg');
  const collector = await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'collector.js'), 'utf8');
  assert.match(collector, /export default/);
  const sql = await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'migrations', '001_initial.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE/);
  // Verify junction/symlink resolves to version dir
  const target = await fs.readlink(path.join(cacheRoot, 'demo-pkg', 'current'));
  assert.match(target, /1\.0\.0/);
});

test('cachePackage replaces junction when version dir already exists', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-cache-'));
  const buf = makeZip();
  const parsed = parseZip(buf);
  await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.0.0', ...parsed });
  // Re-cache with different version
  const manifest2 = { ...makeManifest(), version: '1.1.0' };
  const buf2 = makeZip({ manifest: manifest2 });
  const parsed2 = parseZip(buf2);
  await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.1.0', ...parsed2 });
  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.version, '1.1.0');
});

test('removeCache deletes the entire package cache directory', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-cache-'));
  const buf = makeZip();
  const parsed = parseZip(buf);
  await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.0.0', ...parsed });
  await removeCache(cacheRoot, 'demo-pkg');
  await assert.rejects(fs.stat(path.join(cacheRoot, 'demo-pkg')));
});