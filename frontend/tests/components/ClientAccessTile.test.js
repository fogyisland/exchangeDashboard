import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import ClientAccessTile from '../../src/components/ClientAccessTile.vue';

test('ClientAccessTile renders title, value, and unit', () => {
  const wrapper = mount(ClientAccessTile, {
    props: { title: 'RPC Avg Latency', value: 12, unit: 'ms' }
  });
  const text = wrapper.text();
  assert.ok(text.includes('RPC Avg Latency'), 'title should be visible');
  assert.ok(text.includes('12'), 'value should be visible');
  assert.ok(text.includes('ms'), 'unit should be visible');
});

test('ClientAccessTile renders sparkline when sparkline prop has values', () => {
  const wrapper = mount(ClientAccessTile, {
    props: {
      title: 'RPC Avg Latency',
      value: 12,
      unit: 'ms',
      sparkline: [10, 12, 9, 14, 11, 12]
    }
  });
  const html = wrapper.html();
  assert.ok(html.includes('RPC Avg Latency'));
  assert.ok(html.includes('12'));
  assert.ok(html.includes('ms'));
  const spark = wrapper.find('[data-testid="tile-sparkline"]');
  assert.ok(spark.exists(), 'sparkline svg should be present');
  const poly = wrapper.find('polyline');
  assert.ok(poly.exists(), 'sparkline polyline should be rendered');
  const points = poly.attributes('points');
  assert.ok(points && points.length > 0, 'polyline points should be set');
  // 6 input values -> 6 "(x,y)" pairs joined by spaces
  const pairs = points.trim().split(/\s+/);
  assert.equal(pairs.length, 6, 'sparkline should have one point per input value');
});

test('ClientAccessTile omits sparkline when no values provided', () => {
  const wrapper = mount(ClientAccessTile, {
    props: { title: 'Active Users', value: 42 }
  });
  assert.ok(wrapper.text().includes('Active Users'));
  assert.ok(wrapper.text().includes('42'));
  const spark = wrapper.find('[data-testid="tile-sparkline"]');
  assert.equal(spark.exists(), false, 'sparkline should not render when prop is empty');
});

test('ClientAccessTile color-codes by threshold', () => {
  const ok = mount(ClientAccessTile, {
    props: { title: 'Latency', value: 10, threshold: { warn: 25, crit: 50 } }
  });
  const warn = mount(ClientAccessTile, {
    props: { title: 'Latency', value: 30, threshold: { warn: 25, crit: 50 } }
  });
  const crit = mount(ClientAccessTile, {
    props: { title: 'Latency', value: 75, threshold: { warn: 25, crit: 50 } }
  });
  assert.ok(ok.find('[data-testid="client-access-tile"]').classes().includes('severity-ok'));
  assert.ok(warn.find('[data-testid="client-access-tile"]').classes().includes('severity-warn'));
  assert.ok(crit.find('[data-testid="client-access-tile"]').classes().includes('severity-crit'));
});
