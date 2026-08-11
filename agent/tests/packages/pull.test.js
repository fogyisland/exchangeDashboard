import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { pullPackage } from '../../src/packages/pull.js';
import { loadManifest } from '../../src/packages/manifest.js';

function mkValidZipBuffer() {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    name: 'pkg-test', version: '1.0.0', type: 'timeseries',
    database: {
      metricTable: 'pkgtest_metric',
      metricColumns: {
        agent_id: { type: 'varchar(64)' }, ts: { type: 'datetime' }, value: { type: 'int' }
      }
    }
  })));
  zip.addFile('collector.js', Buffer.from('export default { name: "pkg-test", async collect() { return []; } };'));
  zip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE pkgtest_metric (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NOT NULL, PRIMARY KEY (agent_id, ts))'));
  return zip.toBuffer();
}

test('pullPackage downloads, validates, writes to installPath, and creates current junction', async () => {
  const buf = mkValidZipBuffer();
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  const out = await pullPackage({ name: 'pkg-test', version: '1.0.0', downloadUrl: 'http://stub/pkg-test/zip', installPath, http: stubHttp, logger: { warn() {}, info() {} } });
  assert.equal(out.manifest.name, 'pkg-test');
  // Verify the directory layout
  const versionDir = path.join(installPath, 'packages', 'pkg-test', '1.0.0');
  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(versionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.name, 'pkg-test');
  const collectorOnDisk = await fs.readFile(path.join(versionDir, 'collector.js'), 'utf8');
  assert.match(collectorOnDisk, /pkg-test/);
  const migOnDisk = await fs.readFile(path.join(versionDir, 'migrations/001_initial.sql'), 'utf8');
  assert.match(migOnDisk, /CREATE TABLE/);
  // The manifest can be re-loaded by the existing agent loader
  const reloaded = await loadManifest(path.join(installPath, 'packages'), 'pkg-test');
  assert.equal(reloaded.manifest.name, 'pkg-test');
});

test('pullPackage rejects manifest with name mismatch', async () => {
  const buf = mkValidZipBuffer(); // says pkg-test
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  await assert.rejects(
    pullPackage({ name: 'pkg-other', version: '1.0.0', downloadUrl: 'http://stub', installPath, http: stubHttp, logger: { warn() {}, info() {} } }),
    /name mismatch/i
  );
});

test('pullPackage rejects manifest with version mismatch', async () => {
  const buf = mkValidZipBuffer();
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  await assert.rejects(
    pullPackage({ name: 'pkg-test', version: '2.0.0', downloadUrl: 'http://stub', installPath, http: stubHttp, logger: { warn() {}, info() {} } }),
    /version mismatch/i
  );
});

test('pullPackage rejects invalid manifest (missing metricColumns)', async () => {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: 'pkg-bad', version: '1.0.0', type: 'timeseries', database: { metricTable: 'x', metricColumns: {} } })));
  zip.addFile('collector.js', Buffer.from('export default { name: "x", async collect() { return []; } };'));
  zip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE x (a INT)'));
  const buf = zip.toBuffer();
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  await assert.rejects(
    pullPackage({ name: 'pkg-bad', version: '1.0.0', downloadUrl: 'http://stub', installPath, http: stubHttp, logger: { warn() {}, info() {} } })
  );
});
