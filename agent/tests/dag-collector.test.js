import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DagCollector } from '../src/dag-collector.js';

test('DagCollector returns one copy per database', async () => {
  const stub = {
    counterMulti: async (paths) => {
      const out = {};
      for (const p of paths) out[p] = p.includes('CopyQueueLength') ? '5' : p.includes('MountStatus') ? '1' : '0';
      return out;
    }
  };
  const dc = new DagCollector(stub, { databases: [{ db_id: 'db-1', db_name: 'DB1', server_id: 1 }] });
  const out = await dc.collect();
  assert.equal(out.copies.length, 1);
  assert.equal(out.copies[0].db_id, 'db-1');
  assert.equal(out.copies[0].copy_queue_length, 5);
  assert.equal(out.copies[0].mount_status, 1);
});
