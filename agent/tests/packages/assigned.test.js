import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { readInstalled, writeInstalled, recordInstall } from '../../src/packages/assigned.js';

test('readInstalled returns [] when file missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  const list = await readInstalled(dir);
  assert.deepEqual(list, []);
});

test('writeInstalled + readInstalled round-trips', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  await writeInstalled(dir, [{ name: 'pkg-a', version: '1.0.0' }, { name: 'pkg-b', version: '1.0.0' }]);
  const list = await readInstalled(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'pkg-a');
});

test('recordInstall adds without clobbering existing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  await writeInstalled(dir, [{ name: 'pkg-a', version: '1.0.0' }]);
  await recordInstall(dir, 'pkg-b', '1.0.0');
  const list = await readInstalled(dir);
  assert.equal(list.length, 2);
  assert.ok(list.find((p) => p.name === 'pkg-a'));
  assert.ok(list.find((p) => p.name === 'pkg-b'));
});

test('recordInstall upgrades version if same name re-installed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  await writeInstalled(dir, [{ name: 'pkg-a', version: '1.0.0' }]);
  await recordInstall(dir, 'pkg-a', '1.1.0');
  const list = await readInstalled(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].version, '1.1.0');
});
