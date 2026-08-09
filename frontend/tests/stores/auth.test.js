import assert from 'node:assert/strict';
import { test } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../../src/stores/auth.js';

test('login sets user + token', async () => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const auth = useAuthStore();
  auth.$patch({ user: null, token: '' });
  // Stub the api call
  auth.api = { login: async () => ({ token: 'tok', user: { username: 'admin', role: 'admin' } }) };
  await auth.login({ username: 'admin', password: 'pw12345678' });
  assert.equal(auth.token, 'tok');
  assert.equal(auth.user.username, 'admin');
  assert.equal(auth.isAdmin, true);
});