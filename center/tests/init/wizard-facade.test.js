import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { hasMarker } from '../../src/init/marker.js';
import { wizardFacade } from '../../src/init/wizard-facade.js';

test('wizardFacade rejects unsupported dbKind', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-'));
  const cfg = path.join(dir, 'appsettings.json');
  await fs.writeFile(cfg, '{}');
  const out = await wizardFacade({ dbKind: 'postgres', db: {}, admin: { username: 'a', password: 'longenough' }, installPath: dir, configPath: cfg });
  assert.equal(out.ok, false);
  assert.equal(out.stage, 'test-db');
});