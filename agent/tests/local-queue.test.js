import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { LocalQueue } from '../src/local-queue.js';

test('LocalQueue enqueue/dequeue/len round-trip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lq-'));
  const q = new LocalQueue(path.join(dir, 'q.db'));
  await q.enqueue({ a: 1 });
  await q.enqueue({ a: 2 });
  assert.equal(q.length(), 2);
  const all = await q.dequeueAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].a, 1);
  assert.equal(q.length(), 0);
  q.close();
});