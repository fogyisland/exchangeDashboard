import { test, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PackagesView from '../../../src/views/admin/PackagesView.vue';

vi.mock('../../../src/api/packages.js', () => ({
  packagesApi: {
    list: vi.fn(async () => ({ packages: [{ name: 'foo', version: '1.0.0', type: 'timeseries', enabled: 1, installedAt: new Date().toISOString(), manifest: { name: 'foo', version: '1.0.0' } }] })),
    upload: vi.fn(async () => ({ ok: true, name: 'foo', version: '1.0.0' }))
  }
}));

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});

test('PackagesView shows empty state when no packages installed', async () => {
  const { packagesApi } = await import('../../../src/api/packages.js');
  packagesApi.list.mockResolvedValueOnce({ packages: [] });
  const wrapper = mount(PackagesView);
  await flushPromises();
  expect(wrapper.text()).toMatch(/no packages|empty/i);
});

test('PackagesView lists installed packages', async () => {
  const wrapper = mount(PackagesView);
  await flushPromises();
  expect(wrapper.text()).toContain('foo');
  expect(wrapper.text()).toContain('1.0.0');
});

test('PackagesView upload button calls packagesApi.upload', async () => {
  const wrapper = mount(PackagesView);
  await flushPromises();
  const input = wrapper.find('input[type="file"]');
  const file = new File(['zip-content'], 'demo.zip', { type: 'application/zip' });
  // jsdom rejects `input.value = file`; set files via defineProperty and dispatch change.
  Object.defineProperty(input.element, 'files', { value: [file], writable: false });
  await input.trigger('change');
  const { packagesApi } = await import('../../../src/api/packages.js');
  expect(packagesApi.upload).toHaveBeenCalled();
});
