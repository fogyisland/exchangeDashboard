import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import QueueTable from '../../src/components/QueueTable.vue';

const sampleRows = [
  {
    server_hostname: 'mail-a',
    server_id: 1,
    queue_kind: 'ActiveMailboxDelivery',
    queueKind: 'ActiveMailboxDelivery',
    message_count: 240,
    messageCount: 240,
    messages_per_sec: 1.2,
    messagesPerSec: 1.2,
    captured_at: '2026-08-09T10:00:00Z',
    capturedAt: '2026-08-09T10:00:00Z'
  },
  {
    server_hostname: 'mail-b',
    server_id: 2,
    queue_kind: 'Poison',
    queueKind: 'Poison',
    message_count: 8000,
    messageCount: 8000,
    messages_per_sec: 0,
    messagesPerSec: 0,
    captured_at: '2026-08-09T10:01:00Z',
    capturedAt: '2026-08-09T10:01:00Z'
  },
  {
    server_hostname: 'mail-c',
    server_id: 3,
    queue_kind: 'Submission',
    queueKind: 'Submission',
    message_count: 120,
    messageCount: 120,
    messages_per_sec: 4.5,
    messagesPerSec: 4.5,
    captured_at: '2026-08-09T10:02:00Z',
    capturedAt: '2026-08-09T10:02:00Z'
  }
];

test('QueueTable renders rows and shows columns', () => {
  const wrapper = mount(QueueTable, { props: { rows: sampleRows } });
  const html = wrapper.html();
  assert.ok(html.includes('mail-a'), 'should render mail-a server');
  assert.ok(html.includes('mail-b'), 'should render mail-b server');
  assert.ok(html.includes('mail-c'), 'should render mail-c server');
  assert.ok(html.includes('ActiveMailboxDelivery'), 'should render queue kind');
  assert.ok(html.includes('Poison'), 'should render Poison queue kind');
});

test('QueueTable defaults to descending sort by messageCount', () => {
  const wrapper = mount(QueueTable, { props: { rows: sampleRows } });
  const rows = wrapper.findAll('tbody tr');
  assert.equal(rows.length, 3, 'should render 3 rows');
  // sorted desc by messageCount: 8000 (mail-b), 240 (mail-a), 120 (mail-c)
  assert.ok(rows[0].text().includes('mail-b'));
  assert.ok(rows[1].text().includes('mail-a'));
  assert.ok(rows[2].text().includes('mail-c'));
});

test('QueueTable sort by messageCount asc after clicking header twice', async () => {
  const wrapper = mount(QueueTable, { props: { rows: sampleRows } });
  // First click: switches from 'desc' (messageCount default) to nothing — actually first click while sortKey=messageCount toggles dir
  // sortKey default is messageCount. Click once should toggle direction.
  const header = wrapper.findAll('th').find((h) => h.text().includes('Messages'));
  await header.trigger('click');
  await wrapper.vm.$nextTick();
  const rows = wrapper.findAll('tbody tr');
  // asc: 120 (mail-c), 240 (mail-a), 8000 (mail-b)
  assert.ok(rows[0].text().includes('mail-c'));
  assert.ok(rows[1].text().includes('mail-a'));
  assert.ok(rows[2].text().includes('mail-b'));
});

test('QueueTable shows empty state when no rows', () => {
  const wrapper = mount(QueueTable, { props: { rows: [] } });
  const html = wrapper.html();
  assert.ok(html.includes('No queue data'), 'should show empty message');
  assert.equal(wrapper.findAll('tbody tr').length, 0);
});

test('QueueTable shows loading state when loading=true', () => {
  const wrapper = mount(QueueTable, { props: { rows: [], loading: true } });
  assert.ok(wrapper.html().includes('Loading'), 'should show loading message');
});
