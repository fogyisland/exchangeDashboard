import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { PackagesLoader } from '../../src/packages/loader.js';

const validManifest = (name, table = 'demo_metrics') => ({
  name, version: '1.0.0', type: 'timeseries',
  database: { metricTable: table, metricColumns: { agent_id: { type: 'varchar(64)', nullable: false }, ts: { type: 'datetime', nullable: false }, value: { type: 'int', nullable: true } } }
});

const collectorReturning = (rows) => `export default { name: 'pkg', async collect() { return { rows: ${JSON.stringify(rows)} }; } }`;
const collectorThrowing = () => `export default { name: 'pkg', async collect() { throw new Error('boom'); } }`;

async function installPackage(packagesDir, name, collectorJs) {
  const pkgDir = path.join(packagesDir, name, 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'manifest.json'), JSON.stringify(validManifest(name)));
  await fs.writeFile(path.join(pkgDir, 'collector.js'), collectorJs);
}

test('loadAll returns empty list when packagesDir has no packages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  const r = await loader.loadAll();
  assert.deepEqual(r, []);
});

test('loadAll discovers an installed package and exposes its metricTable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'demo', collectorReturning([{ value: 1 }]));
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  const r = await loader.loadAll();
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'demo');
  assert.equal(r[0].metricTable, 'demo_metrics');
  assert.equal(typeof r[0].collector.collect, 'function');
});

test('loadAll skips packages with missing collector.js (warn, do not throw)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  const pkgDir = path.join(dir, 'broken', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'manifest.json'), JSON.stringify(validManifest('broken')));
  // no collector.js
  const warnings = [];
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn: (m) => warnings.push(m), info() {} } });
  const r = await loader.loadAll();
  assert.equal(r.length, 0);
  assert.ok(warnings.length >= 1);
});

test('loadAll skips packages with bad default export (warn, do not throw)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'badexport', 'export default 42');
  const warnings = [];
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn: (m) => warnings.push(m), info() {} } });
  const r = await loader.loadAll();
  assert.equal(r.length, 0);
  assert.ok(warnings.length >= 1);
});

test('invokeCollect calls collector and returns rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'demo', collectorReturning([{ value: 1 }, { value: 2 }]));
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  await loader.loadAll();
  const r = await loader.invokeCollect('demo', { config: {}, logger: {} });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].value, 1);
});

test('invokeCollect enforces timeout (throws on hang)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  const slowCollector = `export default { name: 'pkg', async collect() { await new Promise(r => setTimeout(r, 10000)); return { rows: [] }; } }`;
  await installPackage(dir, 'slow', slowCollector);
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  await loader.loadAll();
  await assert.rejects(loader.invokeCollect('slow', { config: {}, logger: {} }, { timeoutMs: 100 }), /timeout/);
});

test('invokeCollect wraps collector errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'evil', collectorThrowing());
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  await loader.loadAll();
  await assert.rejects(loader.invokeCollect('evil', { config: {}, logger: {} }), /boom/);
});