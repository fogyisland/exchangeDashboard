import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { vi } from 'vitest';

const sampleAudit = [
  { id: 1, timestamp: '2026-08-09T10:00:00Z', user: 'alice', action: 'user.create', target: 'bob', detail: 'created bob' },
  { id: 2, timestamp: '2026-08-09T10:01:00Z', user: 'alice', action: 'config.update', target: 'retention_days', detail: '30 -> 45' },
  { id: 3, timestamp: '2026-08-09T10:02:00Z', user: 'bob', action: 'login.success', target: '-', detail: '' },
  { id: 4, timestamp: '2026-08-09T10:03:00Z', user: 'alice', action: 'user.delete', target: 'charlie', detail: 'deleted charlie' },
  { id: 5, timestamp: '2026-08-09T10:04:00Z', user: 'admin', action: 'migration.apply', target: 'm-002', detail: 'applied migration m-002' }
];

vi.mock('../../../src/api/admin.js', () => ({
  users: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  roles: { list: vi.fn(async () => ({ roles: [] })) },
  config: { getAll: vi.fn(), set: vi.fn() },
  audit: { list: vi.fn(async () => ({ rows: sampleAudit, total: 5 })) },
  servers: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dags: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dbs: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dagReplication: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  ports: { probe: vi.fn() },
  heartbeatReport: { list: vi.fn(), stale: vi.fn() }
}));

const AuditView = (await import('../../../src/views/admin/AuditView.vue')).default;

test('AuditView renders five audit rows from API', async () => {
  const wrapper = mount(AuditView);
  await flushPromises();
  await flushPromises();

  const text = wrapper.text();
  assert.ok(text.includes('alice'), 'should render alice user');
  assert.ok(text.includes('bob'), 'should render bob user');
  assert.ok(text.includes('admin'), 'should render admin user');
  assert.ok(text.includes('user.create'), 'should render action user.create');
  assert.ok(text.includes('config.update'), 'should render action config.update');
  assert.ok(text.includes('migration.apply'), 'should render action migration.apply');

  const rows = wrapper.findAll('[data-testid^="audit-row-"]');
  assert.equal(rows.length, 5, 'should render 5 audit rows');

  const table = wrapper.find('[data-testid="audit-table"]');
  assert.ok(table.exists(), 'audit table should be visible');
});

test('AuditView shows pagination pager with prev/next buttons', async () => {
  const wrapper = mount(AuditView);
  await flushPromises();
  await flushPromises();

  const pager = wrapper.find('[data-testid="audit-pager"]');
  assert.ok(pager.exists(), 'pager should be visible');
  assert.ok(wrapper.find('[data-testid="audit-prev"]').exists(), 'prev button should exist');
  assert.ok(wrapper.find('[data-testid="audit-next"]').exists(), 'next button should exist');

  const text = wrapper.text();
  assert.ok(text.includes('Page 1'), 'should show current page number');
});