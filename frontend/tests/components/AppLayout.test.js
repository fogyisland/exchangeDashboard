import assert from 'node:assert/strict';
import { test, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import AppLayout from '../../src/components/AppLayout.vue';
import { useAuthStore } from '../../src/stores/auth.js';

function makeRouter() {
  // AppLayout's nav links point at the real dashboard routes (/mailflow,
  // /dag, /client-access, /servers-overview, /dashboard/metrics,
  // /lockout-troubleshooting). Register stubs for each so vue-router
  // doesn't emit "No match found" warnings during mount.
  const stub = (name) => ({ template: `<div class="x">${name}</div>` });
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: stub('home') },
      { path: '/admin', component: stub('admin') },
      { path: '/login', component: stub('login') },
      { path: '/mailflow', component: stub('mailflow') },
      { path: '/dag', component: stub('dag') },
      { path: '/client-access', component: stub('client-access') },
      { path: '/servers-overview', component: stub('servers-overview') },
      { path: '/dashboard/metrics', component: stub('metrics') },
      { path: '/lockout-troubleshooting', component: stub('lockout') }
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
