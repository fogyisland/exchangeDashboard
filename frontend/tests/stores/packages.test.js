import assert from 'node:assert/strict';
import { test } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePackagesStore } from '../../src/stores/packages.js';

test('fetchInstalled populates installed as an array (empty placeholder)', async () => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const store = usePackagesStore();
  assert.deepEqual(store.installed, [], 'installed starts as empty array');
  assert.equal(store.loading, false, 'loading starts false');
  assert.equal(store.error, '', 'error starts empty');

  // Stub the underlying api call
  store.api = { installed: async () => ({ packages: [] }) };

  await store.fetchInstalled();
  assert.ok(Array.isArray(store.installed), 'installed is an array after fetch');
  assert.equal(store.installed.length, 0, 'installed is empty for placeholder api');
  assert.equal(store.loading, false, 'loading flag cleared after fetch');
  assert.equal(store.error, '', 'no error after successful fetch');
});

test('fetchInstalled accepts a bare array response', async () => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const store = usePackagesStore();
  store.api = {
    installed: async () => [
      { name: 'core-metrics' },
      { name: 'dag-overview' }
    ]
  };
  const result = await store.fetchInstalled();
  assert.equal(result.length, 2);
  assert.equal(store.installed[0].name, 'core-metrics');
});

test('has() checks installed list by name (case-insensitive)', async () => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const store = usePackagesStore();
  store.api = { installed: async () => ({ packages: [{ name: 'Core-Metrics' }] }) };
  await store.fetchInstalled();
  assert.equal(store.has('core-metrics'), true);
  assert.equal(store.has('CORE-METRICS'), true);
  assert.equal(store.has('not-installed'), false);
  assert.equal(store.has(''), false);
  assert.equal(store.has(null), false);
});