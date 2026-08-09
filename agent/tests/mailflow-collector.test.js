import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailflowCollector } from '../src/mailflow-collector.js';

test('MailflowCollector returns normalized queue snapshots', async () => {
  const stub = { counterMulti: async () => ({
    '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length': '12',
    '\\MSExchangeTransport Queues(_total)\\Poison Queue Length': '0',
    '\\MSExchangeTransport Queues(_total)\\Retry Queue Length': '3',
    '\\MSExchangeTransport Submission Queue(_total)\\Submission Queue Length': '7',
    '\\MSExchangeTransport Queues(_total)\\Messages Queued Per Second': '5.5'
  }) };
  const mc = new MailflowCollector(stub);
  const out = await mc.collect();
  assert.ok(out.length >= 4);
  const poison = out.find((r) => r.queue_kind === 'Poison');
  assert.equal(poison.message_count, 0);
  const retry = out.find((r) => r.queue_kind === 'Retry');
  assert.equal(retry.message_count, 3);
});
