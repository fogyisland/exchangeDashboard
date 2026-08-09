import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServicesCollector } from '../src/services-collector.js';

test('ServicesCollector returns Exchange services + resources', async () => {
  const stub = {
    counterMulti: async () => ({ '\\Processor(_total)\\% Processor Time': '12', '\\Memory\\Available MBytes': '8192', '\\LogicalDisk(C:)\\% Free Space': '42', '\\Network Interface(*)\\Bytes Total/sec': '1000' }),
    wmi: async () => [
      { Name: 'MSExchangeTransport', State: 'Running', StartMode: 'Auto' },
      { Name: 'MSExchangeMailbox', State: 'Stopped', StartMode: 'Auto' }
    ]
  };
  const sc = new ServicesCollector(stub);
  const out = await sc.collect();
  assert.equal(out.services.length, 2);
  assert.equal(out.resources.cpu_pct, 12);
  assert.equal(out.resources.memory_available_mb, 8192);
});
