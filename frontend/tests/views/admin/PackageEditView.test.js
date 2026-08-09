import { test, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import PackageEditView from '../../../src/views/admin/PackageEditView.vue';

vi.mock('../../../src/api/packages.js', () => ({
  packagesApi: {
    get: vi.fn(async () => ({ name: 'foo', version: '1.0.0', type: 'timeseries', enabled: 1, installedAt: new Date().toISOString(), manifest: { name: 'foo', version: '1.0.0' } })),
    uninstall: vi.fn(async () => ({ ok: true })),
    enable: vi.fn(async () => ({ ok: true })),
    disable: vi.fn(async () => ({ ok: true }))
  }
}));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/packages/:name', component: PackageEditView },
      { path: '/admin/packages', component: { template: '<div>list</div>' } }
    ]
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});

test('PackageEditView shows package name and version', async () => {
  const router = makeRouter();
  router.push('/admin/packages/foo');
  await router.isReady();
  const wrapper = mount(PackageEditView, { global: { plugins: [router] } });
  await flushPromises();
  expect(wrapper.text()).toContain('foo');
  expect(wrapper.text()).toContain('1.0.0');
});

test('PackageEditView shows uninstall button with confirm modal', async () => {
  const router = makeRouter();
  router.push('/admin/packages/foo');
  await router.isReady();
  const wrapper = mount(PackageEditView, { global: { plugins: [router] } });
  await flushPromises();
  expect(wrapper.text().toLowerCase()).toContain('uninstall');
});

test('PackageEditView uninstall button calls packagesApi.uninstall after confirm', async () => {
  const router = makeRouter();
  router.push('/admin/packages/foo');
  await router.isReady();
  const wrapper = mount(PackageEditView, { global: { plugins: [router] } });
  await flushPromises();
  const { packagesApi } = await import('../../../src/api/packages.js');
  packagesApi.uninstall.mockClear();

  // Verify the confirm checkbox gates the button
  const checkbox = wrapper.find('[data-testid="package-uninstall-confirm"]');
  expect(checkbox.exists()).toBe(true);
  const uninstallBtn = wrapper.find('[data-testid="package-uninstall-btn"]');
  expect(uninstallBtn.exists()).toBe(true);

  // Before confirm: button should be disabled
  expect(uninstallBtn.attributes('disabled')).toBeDefined();

  // Check the confirm checkbox
  await checkbox.setValue(true);
  await flushPromises();

  // After confirm: button should be enabled
  expect(uninstallBtn.attributes('disabled')).toBeUndefined();

  // Click the uninstall button
  await uninstallBtn.trigger('click');
  await flushPromises();

  // Verify the API was called with the correct package name
  expect(packagesApi.uninstall).toHaveBeenCalledWith('foo');
});
