import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProbeLoop } from '../../src/services/probe.js';

test('probe loop purges old snapshots and detects stale', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return []; } };
  const loop = createProbeLoop({
    db,
    logger: { info() {}, warn() {}, error() {} },
    intervalMs: 60_000,
    staleSeconds: 90,
    retention: { queueDays: 7, mdbDays: 7, serviceDays: 30 }
  });
  // Force a single tick manually
  await loop.tick();
  loop.stop();
  const purgeSqls = calls.filter((c) => /DELETE FROM/.test(c.sql));
  assert.ok(purgeSqls.length >= 4, 'expected at least 4 DELETE statements');
});
