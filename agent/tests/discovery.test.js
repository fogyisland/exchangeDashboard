import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/discovery.js';

test('discover returns expected fields', async () => {
  // Fake registry readers
  const fakeRegistry = {
    readExchangeInstallPath: async () => 'C:\\Program Files\\Microsoft\\Exchange Server\\V15',
    readExchangeVersion: async () => '15.2',
    readServerRoleFlags: async () => 7,
    readDagMembership: async () => 1
  };
  const d = await discover({ hostname: 'ex01', fqdn: 'ex01.local', osVersion: 'Win2022', registry: fakeRegistry });
  assert.equal(d.hostname, 'ex01');
  assert.equal(d.exchangeVersion, '15.2');
  assert.equal(d.serverRole, 7);
  assert.equal(d.dagId, 1);
  assert.ok(d.agentId && d.agentId.length > 0);
});