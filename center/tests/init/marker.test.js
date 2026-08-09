import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { hasMarker, writeMarker } from '../../src/init/marker.js';

test('hasMarker returns false when .env missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-'));
  assert.equal(await hasMarker({ configPath: path.join(dir, 'x.json') }), false);
});

test('writeMarker writes .env sibling and hasMarker then true', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-'));
  const cfg = path.join(dir, 'appsettings.json');
  await fs.writeFile(cfg, '{}');
  await writeMarker({ configPath: cfg });
  assert.equal(await hasMarker({ configPath: cfg }), true);
  const env = await fs.readFile(path.join(dir, '.env'), 'utf8');
  assert.match(env, /EXDASHBOARD_INITIALIZED=1/);
});