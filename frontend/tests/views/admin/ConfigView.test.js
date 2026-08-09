import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { vi } from 'vitest';

const sampleConfig = [
  { key: 'retention_days', value: '30', updated_at: '2026-08-01T10:00:00Z' },
  { key: 'alerts.email_to', value: 'ops@example.com', updated_at: '2026-08-02T11:00:00Z' },
  { key: 'agent.poll_seconds', value: '60', updated_at: '2026-08-03T09:30:00Z' }
];

const setSpy = vi.fn(async () => ({}));

vi.mock('../../../src/api/admin.js', () => ({
  users: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  roles: { list: vi.fn(async () => ({ roles: [] })) },
  config: {
    getAll: vi.fn(async () => ({ rows: sampleConfig })),
    set: setSpy
  },
  audit: { list: vi.fn() },
  servers: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dags: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dbs: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dagReplication: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  ports: { probe: vi.fn() },
  heartbeatReport: { list: vi.fn(), stale: vi.fn() }
}));

const ConfigView = (await import('../../../src/views/admin/ConfigView.vue')).default;

test('ConfigView renders three config rows from API', async () => {
  const wrapper = mount(ConfigView);
  await flushPromises();
  await flushPromises();

  const text = wrapper.text();
  assert.ok(text.includes('retention_days'), 'should render retention_days key');
  assert.ok(text.includes('30'), 'should render value 30');
  assert.ok(text.includes('alerts.email_to'), 'should render alerts.email_to key');
  assert.ok(text.includes('ops@example.com'), 'should render email value');
  assert.ok(text.includes('agent.poll_seconds'), 'should render agent.poll_seconds key');
  assert.ok(text.includes('60'), 'should render poll value 60');

  const rows = wrapper.findAll('[data-testid^="config-row-"]');
  assert.equal(rows.length, 3, 'should render 3 config rows');
});

test('ConfigView supports edit-in-place and saves via API', async () => {
  const wrapper = mount(ConfigView);
  await flushPromises();
  await flushPromises();

  // Click Edit on the first row (retention_days).
  const editBtn = wrapper.find('[data-testid="config-edit-retention_days"]');
  assert.ok(editBtn.exists(), 'edit button should exist for retention_days');
  await editBtn.trigger('click');
  await wrapper.vm.$nextTick();

  const input = wrapper.find('[data-testid="config-input-retention_days"]');
  assert.ok(input.exists(), 'input should appear in edit mode');
  await input.setValue('45');
  await wrapper.vm.$nextTick();

  const saveBtn = wrapper.find('[data-testid="config-save-retention_days"]');
  assert.ok(saveBtn.exists(), 'save button should appear in edit mode');
  await saveBtn.trigger('click');
  await flushPromises();

  assert.equal(setSpy.mock.calls.length, 1, 'config.set should be called once');
  const [keyArg, valueArg] = setSpy.mock.calls[0];
  assert.equal(keyArg, 'retention_days', 'set should be called with the row key');
  assert.equal(valueArg, '45', 'set should be called with the new value');

  const text = wrapper.text();
  assert.ok(text.includes('Updated retention_days.'), 'success message should appear');
  assert.ok(text.includes('45'), 'new value should be visible in display mode');
});