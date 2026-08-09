import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStuckMessages } from '../../src/services/mailflow.js';

test('getStuckMessages returns high-deferred + poison + retry rows', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return [{ id: 1, server_id: 1, queue_kind: 'Poison', message_count: 3 }]; } };
  const out = await getStuckMessages(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].queue_kind, 'Poison');
  assert.ok(/queue_snapshots/.test(calls[0].sql));
});
