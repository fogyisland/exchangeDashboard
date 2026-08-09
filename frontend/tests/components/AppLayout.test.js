import assert from 'node:assert/strict';
import { test, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import AppLayout from '../../src/components/AppLayout.vue';
import { useAuthStore } from '../../src/stores/auth.js';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div class="x">home</div>' } },
      { path: '/admin', component: { template: '<div class="x">admin</div>' } },
      { path: '/login', component: { template: '<div class="x">login</div>' } }
    ]
  });
}

function makeAuthStore({ isAdmin, username }) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.$patch({
    token: 'tok',
    user: { username: username || 'user', role: isAdmin ? 'admin' : 'viewer' }
  });
  return auth;
}

beforeEach(() => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});

test('AppLayout shows admin link when user is admin', async () => {
  makeAuthStore({ isAdmin: true, username: 'alice' });
  const router = makeRouter();
  router.push('/');
  await router.isReady();
  const wrapper = mount(AppLayout, {
    global: { plugins: [router] }
  });
  await flushPromises();
  const links = wrapper.findAll('a');
  const adminLink = links.find((a) => a.attributes('href') === '/admin' || a.text().includes('Admin') || a.text().includes('管理'));
  assert.ok(adminLink, 'admin link should be rendered for admin user');
  assert.equal(wrapper.text().includes('alice'), true, 'username should be shown in topbar');
});

test('AppLayout does NOT show admin link when user is not admin', async () => {
  makeAuthStore({ isAdmin: false, username: 'bob' });
  const router = makeRouter();
  router.push('/');
  await router.isReady();
  const wrapper = mount(AppLayout, {
    global: { plugins: [router] }
  });
  await flushPromises();
  // find all anchors / links that point to /admin
  const adminLinks = wrapper.findAll('a').filter((a) => a.attributes('href') === '/admin');
  assert.equal(adminLinks.length, 0, 'admin link should NOT be rendered for non-admin user');
  assert.equal(wrapper.text().includes('bob'), true, 'username should still be shown');
});
