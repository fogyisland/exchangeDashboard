import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientAccessCollector } from '../src/clientaccess-collector.js';

test('ClientAccessCollector returns 6 metrics', async () => {
  const stub = { counterMulti: async () => ({
    '\\MSExchange RpcClientAccess\\RPC Average Latency': '12',
    '\\MSExchange RpcClientAccess\\Active User Count': '100',
    '\\MSExchange ActiveSync\\ActiveSync Requests/sec': '5',
    '\\MSExchange ActiveSync\\Average Command Processing Time': '50',
    '\\MSExchange MapiHttp\\Average Request Time': '20',
    '\\MSExchange Outlook Anywhere\\Average RPC Response Time': '80'
  }) };
  const c = new ClientAccessCollector(stub);
  const out = await c.collect();
  assert.equal(out.length, 6);
  assert.ok(out.find((r) => r.metric === 'RpcClientAccess.AverageLatency' && r.value === 12));
});
