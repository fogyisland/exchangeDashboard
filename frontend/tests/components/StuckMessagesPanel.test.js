import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import StuckMessagesPanel from '../../src/components/StuckMessagesPanel.vue';

const rows = [
  {
    server_hostname: 'mail-a',
    server_id: 1,
    queue_kind: 'Poison',
    message_count: 12000,
    captured_at: '2026-08-09T10:00:00Z'
  },
  {
    server_hostname: 'mail-b',
    server_id: 2,
    queue_kind: 'Retry',
    message_count: 50,
    captured_at: '2026-08-09T10:01:00Z'
  },
  {
    server_hostname: 'mail-c',
    server_id: 3,
    queue_kind: 'ActiveMailboxDelivery',
    message_count: 500, // under threshold, should be filtered out
    captured_at: '2026-08-09T10:02:00Z'
  },
  {
    server_hostname: 'mail-d',
    server_id: 4,
    queue_kind: 'ActiveMailboxDelivery',
    message_count: 9999, // over threshold, should be included
    captured_at: '2026-08-09T10:03:00Z'
  },
  {
    server_hostname: 'mail-e',
    server_id: 5,
    queue_kind: 'Submission',
    message_count: 2500, // not in (Poison|Retry) but > threshold; only ActiveMailboxDelivery qualifies
    captured_at: '2026-08-09T10:04:00Z'
  }
];

test('StuckMessagesPanel filters to Poison/Retry and high-count queues', () => {
  const wrapper = mount(StuckMessagesPanel, { props: { rows, threshold: 1000 } });
  const trs = wrapper.findAll('tbody tr');
  assert.equal(trs.length, 3, 'should include Poison, Retry, and mail-d only');
  const html = wrapper.html();
  assert.ok(html.includes('mail-a'));
  assert.ok(html.includes('mail-b'));
  assert.ok(html.includes('mail-d'));
  assert.ok(!html.includes('mail-c'), 'mail-c (count under threshold) should be excluded');
  assert.ok(!html.includes('mail-e'), 'mail-e (Submission not in filter list) should be excluded');
});

test('StuckMessagesPanel flags severity correctly', () => {
  const wrapper = mount(StuckMessagesPanel, { props: { rows, threshold: 1000 } });
  const html = wrapper.html();
  assert.ok(html.includes('Critical'), 'Poison row should be Critical');
  assert.ok(html.includes('Warning'), 'Retry row should be Warning');
  assert.ok(html.includes('High'), 'High-count row should be High');
});

test('StuckMessagesPanel shows empty state when no stuck rows', () => {
  const wrapper = mount(StuckMessagesPanel, { props: { rows: [], threshold: 1000 } });
  const html = wrapper.html();
  assert.ok(html.includes('No stuck messages'), 'should show empty message');
});

test('StuckMessagesPanel respects custom threshold', () => {
  // With threshold=100, mail-c (500) and mail-e (2500) will be excluded (no ActiveMailboxDelivery over threshold remains)
  // mail-c queue_kind ActiveMailboxDelivery 500 > 100 — but per code, only ActiveMailboxDelivery with > threshold counts
  // So with threshold=100, mail-c IS included.
  const wrapper = mount(StuckMessagesPanel, { props: { rows, threshold: 100 } });
  const trs = wrapper.findAll('tbody tr');
  assert.equal(trs.length, 4, 'should include Poison, Retry, mail-c, mail-d with lower threshold');
});
