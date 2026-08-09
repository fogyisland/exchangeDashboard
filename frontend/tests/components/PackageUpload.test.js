import { test, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PackageUpload from '../../src/components/PackageUpload.vue';

test('PackageUpload renders a file picker accepting .zip', () => {
  const wrapper = mount(PackageUpload);
  const input = wrapper.find('input[type="file"]');
  expect(input.exists()).toBe(true);
  expect(input.attributes('accept')).toContain('.zip');
});

test('PackageUpload shows upload progress while uploading', async () => {
  const wrapper = mount(PackageUpload, { props: { uploading: true } });
  await flushPromises();
  expect(wrapper.text()).toMatch(/upload|installing|progress/i);
});

test('PackageUpload displays error when upload fails', async () => {
  const wrapper = mount(PackageUpload, { props: { error: 'PKG_DDL_FORBIDDEN: bad sql' } });
  await flushPromises();
  expect(wrapper.text()).toContain('PKG_DDL_FORBIDDEN');
});
