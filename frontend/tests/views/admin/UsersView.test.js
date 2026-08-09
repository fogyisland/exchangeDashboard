import assert from 'node:assert/strict';
import { test, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const sampleUsers = [
  {
    id: 1,
    username: 'alice',
    role: 'admin',
    disabled: false,
    created_at: '2026-08-01T10:00:00Z'
  },
  {
    id: 2,
    username: 'bob',
    role: 'viewer',
    disabled: true,
    created_at: '2026-08-02T11:30:00Z'
  }
];

// Stub the admin API module before the view is loaded.
import { vi } from 'vitest';
vi.mock('../../../src/api/admin.js', () => ({
  users: {
    list: vi.fn(async () => ({ users: sampleUsers })),
    create: vi.fn(async (body) => ({ id: 3, ...body, disabled: false })),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({}))
  },
  roles: { list: vi.fn(async () => ({ roles: [] })) },
  config: { getAll: vi.fn(), set: vi.fn() },
  audit: { list: vi.fn() },
  servers: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dags: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dbs: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  dagReplication: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  ports: { probe: vi.fn() },
  heartbeatReport: { list: vi.fn(), stale: vi.fn() }
}));

const UsersView = (await import('../../../src/views/admin/UsersView.vue')).default;

beforeEach(() => {
  // jsdom does not have window.confirm by default — provide a no-op stub.
  globalThis.window = globalThis.window || {};
  globalThis.window.confirm = () => true;
});

test('UsersView renders two users from API and shows create form', async () => {
  const wrapper = mount(UsersView);
  await flushPromises();
  await flushPromises();

  const text = wrapper.text();
  assert.ok(text.includes('alice'), 'should render alice row');
  assert.ok(text.includes('bob'), 'should render bob row');
  assert.ok(text.includes('admin'), 'should show alice role label');
  assert.ok(text.includes('viewer'), 'should show bob role label');

  const rows = wrapper.findAll('[data-testid^="user-row-"]');
  assert.equal(rows.length, 2, 'should render 2 user rows');

  const form = wrapper.find('[data-testid="create-form"]');
  assert.ok(form.exists(), 'create form should be visible');
  assert.ok(wrapper.find('[data-testid="create-username"]').exists(), 'username input should be present');
  assert.ok(wrapper.find('[data-testid="create-password"]').exists(), 'password input should be present');
  assert.ok(wrapper.find('[data-testid="create-submit"]').exists(), 'submit button should be present');

  const table = wrapper.find('[data-testid="users-table"]');
  assert.ok(table.exists(), 'users table should be visible');
});

test('UsersView submit button is disabled when password < 8 chars', async () => {
  const wrapper = mount(UsersView);
  await flushPromises();

  await wrapper.find('[data-testid="create-username"]').setValue('charlie');
  await wrapper.find('[data-testid="create-password"]').setValue('short');
  await wrapper.vm.$nextTick();

  const btn = wrapper.find('[data-testid="create-submit"]');
  assert.ok(btn.exists(), 'submit button should exist');
  assert.equal(btn.attributes('disabled') !== undefined, true, 'submit should be disabled with short password');
});