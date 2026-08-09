import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import CounterTile from '../../../src/components/metrics/CounterTile.vue';

test('CounterTile renders label, value, and unit', () => {
  const wrapper = mount(CounterTile, {
    props: { label: 'Mailbox Count', value: 1234, unit: 'mailboxes' }
  });
  const text = wrapper.text();
  assert.ok(text.includes('Mailbox Count'), 'label should be visible');
  assert.ok(text.includes('1234'), 'value should be visible');
  assert.ok(text.includes('mailboxes'), 'unit should be visible');
});

test('CounterTile formats large values without decimals', () => {
  const wrapper = mount(CounterTile, {
    props: { label: 'Messages / sec', value: 2547, unit: 'msg/s' }
  });
  const valueEl = wrapper.find('[data-testid="counter-value"]');
  assert.equal(valueEl.text(), '2547');
});

test('CounterTile shows positive delta with up arrow', () => {
  const wrapper = mount(CounterTile, {
    props: { label: 'Queue Depth', value: 100, unit: 'msg', delta: 12 }
  });
  const deltaEl = wrapper.find('[data-testid="counter-delta"]');
  assert.ok(deltaEl.exists(), 'delta should render when provided');
  assert.ok(deltaEl.classes().includes('delta-up'), 'positive delta uses up class');
  assert.ok(deltaEl.text().includes('12'), 'delta magnitude should be shown');
});

test('CounterTile omits delta when not provided', () => {
  const wrapper = mount(CounterTile, {
    props: { label: 'Sessions', value: 42 }
  });
  const deltaEl = wrapper.find('[data-testid="counter-delta"]');
  assert.equal(deltaEl.exists(), false, 'delta should not render when not provided');
});

test('CounterTile renders "-" when value is null', () => {
  const wrapper = mount(CounterTile, {
    props: { label: 'Pending', value: null }
  });
  const valueEl = wrapper.find('[data-testid="counter-value"]');
  assert.equal(valueEl.text(), '-');
});