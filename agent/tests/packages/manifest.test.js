import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadManifest } from '../../src/packages/manifest.js';

function writeManifest(dir, manifest) {
  return fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

const validManifest = {
  name: 'agent-demo',
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

test('loadManifest returns parsed manifest for an installed package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const pkgDir = path.join(root, 'agent-demo', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await writeManifest(pkgDir, validManifest);
  const r = await loadManifest(root, 'agent-demo');
  assert.ok(r);
  assert.equal(r.name, 'agent-demo');
  assert.equal(r.manifest.version, '1.0.0');
  assert.equal(r.cachePath, pkgDir);
});

test('loadManifest returns null when package is not installed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const r = await loadManifest(root, 'missing');
  assert.equal(r, null);
});

test('loadManifest throws when manifest.json is invalid JSON', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const pkgDir = path.join(root, 'broken', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'manifest.json'), '{not valid');
  await assert.rejects(loadManifest(root, 'broken'), /JSON/);
});

test('loadManifest throws when manifest fails schema validation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const pkgDir = path.join(root, 'bad', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  // missing metricColumns
  await writeManifest(pkgDir, { name: 'bad', version: '1.0.0', type: 'timeseries', database: { metricTable: 'foo' } });
  await assert.rejects(loadManifest(root, 'bad'), /manifest/);
});