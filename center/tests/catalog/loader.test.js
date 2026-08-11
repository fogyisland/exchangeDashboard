import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadCatalog } from '../../src/packages/catalog/loader.js';

test('loadCatalog returns built-in when no remote URL set', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0', updatedAt: '2026-08-11',
    packages: [{ name: 'pkg-x', version: '1.0.0', title: 'X', summary: 's', roleFlags: 1, zipPath: 'built-in/x.zip' }]
  }));
  // Need a real (empty) ZIP at built-in/x.zip
  await fs.writeFile(path.join(builtInDir, 'x.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const out = await loadCatalog({ config: {}, builtInDir, catalogJsonPath: catalogPath });
  assert.equal(out.source, 'built-in');
  assert.equal(out.packages.length, 1);
  assert.equal(out.packages[0].name, 'pkg-x');
});

test('loadCatalog falls back to built-in when remote fetch throws', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0', packages: [{ name: 'pkg-y', version: '1.0.0', zipPath: 'built-in/y.zip' }]
  }));
  await fs.writeFile(path.join(builtInDir, 'y.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const brokenFetcher = async () => { throw new Error('network down'); };
  const out = await loadCatalog({ config: { packageCatalogUrl: 'https://example.com/cat.json' }, builtInDir, catalogJsonPath: catalogPath, fetcher: brokenFetcher });
  assert.equal(out.source, 'built-in');
  assert.equal(out.packages[0].name, 'pkg-y');
});

test('loadCatalog merges in remote entries when fetch OK and ZIPs present', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0', packages: [{ name: 'pkg-z', version: '1.0.0', zipPath: 'built-in/z.zip' }]
  }));
  await fs.writeFile(path.join(builtInDir, 'z.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const goodFetcher = async () => JSON.stringify({
    version: '2.0.0', packages: [{ name: 'pkg-z', version: '1.5.0', zipPath: 'built-in/z.zip' }]
  });
  const out = await loadCatalog({ config: { packageCatalogUrl: 'https://example.com/cat.json' }, builtInDir, catalogJsonPath: catalogPath, fetcher: goodFetcher });
  // Remote entry overrides built-in for same name
  assert.equal(out.source, 'remote');
  assert.equal(out.packages[0].version, '1.5.0');
});

test('loadCatalog skips remote entries whose zipPath is not in built-in/', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({ version: '1.0.0', packages: [] }));

  const fetcher = async () => JSON.stringify({
    version: '1.0.0', packages: [
      { name: 'pkg-ok', version: '1.0.0', zipPath: 'built-in/ok.zip' },
      { name: 'pkg-bad', version: '1.0.0', zipPath: 'built-in/does-not-exist.zip' }
    ]
  });
  const out = await loadCatalog({ config: { packageCatalogUrl: 'https://example.com/cat.json' }, builtInDir, catalogJsonPath: catalogPath, fetcher });
  assert.equal(out.packages.length, 0); // both skipped (ok.zip not present, bad entry has no zip)
});

test('loadCatalog returns source none when neither built-in nor remote resolves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const out = await loadCatalog({ config: {}, builtInDir: path.join(dir, 'missing'), catalogJsonPath: path.join(dir, 'missing.json') });
  assert.equal(out.source, 'none');
  assert.equal(out.packages.length, 0);
});

test('loadCatalog is idempotent across multiple calls', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({ version: '1.0.0', packages: [{ name: 'pkg-i', version: '1.0.0', zipPath: 'built-in/i.zip' }] }));
  await fs.writeFile(path.join(builtInDir, 'i.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const a = await loadCatalog({ config: {}, builtInDir, catalogJsonPath: catalogPath });
  const b = await loadCatalog({ config: {}, builtInDir, catalogJsonPath: catalogPath });
  assert.deepEqual(a, b);
});