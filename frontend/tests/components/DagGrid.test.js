import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import DagGrid from '../../src/components/DagGrid.vue';

test('DagGrid renders a row per database and a cell per server', () => {
  const databases = [
    {
      db_id: 1,
      db_name: 'Mailbox DB1',
      server_id: 1,
      edb_file_path: 'C:\\Exchange\\DB1\\mailbox.edb',
      log_folder_path: 'C:\\Exchange\\DB1\\logs',
      circular_logging: 0
    },
    {
      db_id: 1,
      db_name: 'Mailbox DB1',
      server_id: 2,
      edb_file_path: 'C:\\Exchange\\DB1\\mailbox.edb',
      log_folder_path: 'C:\\Exchange\\DB1\\logs',
      circular_logging: 0
    }
  ];
  const copyStatus = [
    { server_id: 1, db_id: 1, copy_queue_length: 5, replay_lag_seconds: 0, mount_status: 1, is_active_copy: 1 },
    { server_id: 2, db_id: 1, copy_queue_length: 2, replay_lag_seconds: 1, mount_status: 0, is_active_copy: 0 }
  ];

  const wrapper = mount(DagGrid, { props: { databases, copyStatus } });
  const html = wrapper.html();
  // Database name rendered
  assert.ok(html.includes('Mailbox DB1'), 'should render DB name');
  // Server hostnames appear in the header
  assert.ok(html.includes('mailbox-a') || html.includes('mailbox-b') || html.includes('#1') || html.includes('#2'), 'should render server columns');
  // 2 cells (1 DB × 2 servers)
  const cells = wrapper.findAll('[data-testid="dag-grid-cell"]');
  assert.equal(cells.length, 2, 'should render 2 cells');
  // One cell mounted (green), one dismounted (red) — assert via class names
  const mountedCells = wrapper.findAll('.cell-mounted');
  const unmountedCells = wrapper.findAll('.cell-unmounted');
  assert.equal(mountedCells.length, 1, 'one cell should be marked mounted');
  assert.equal(unmountedCells.length, 1, 'one cell should be marked dismounted');
  // Queue / lag rendered
  assert.ok(html.includes('Queue: 5'), 'should render copy queue length');
  assert.ok(html.includes('Mounted'), 'should render Mounted label');
  assert.ok(html.includes('Dismounted'), 'should render Dismounted label');
});

test('DagGrid shows empty state when no databases', () => {
  const wrapper = mount(DagGrid, { props: { databases: [], copyStatus: [] } });
  const html = wrapper.html();
  assert.ok(html.includes('No databases for this DAG'), 'should show empty message');
});