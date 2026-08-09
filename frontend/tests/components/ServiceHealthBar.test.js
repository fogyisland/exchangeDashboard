import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import ServiceHealthBar from '../../src/components/ServiceHealthBar.vue';

test('ServiceHealthBar shows empty message when no services', () => {
  const wrapper = mount(ServiceHealthBar, { props: { services: [] } });
  const text = wrapper.text();
  assert.ok(text.includes('no services reported'), 'should render empty placeholder');
  assert.equal(wrapper.findAll('[data-testid="service-row"]').length, 0);
});

test('ServiceHealthBar renders one row per service', () => {
  const services = [
    { service_name: 'MSExchangeTransport', state: 'Running', start_mode: 'Auto' },
    { service_name: 'MSExchangeIS', state: 'Stopped', start_mode: 'Disabled' }
  ];
  const wrapper = mount(ServiceHealthBar, { props: { services } });
  const rows = wrapper.findAll('[data-testid="service-row"]');
  assert.equal(rows.length, 2);
  assert.ok(wrapper.text().includes('MSExchangeTransport'));
  assert.ok(wrapper.text().includes('MSExchangeIS'));
});

test('ServiceHealthBar color-codes running services green', () => {
  const wrapper = mount(ServiceHealthBar, {
    props: { services: [{ service_name: 'Svc', state: 'Running', start_mode: 'Auto' }] }
  });
  const row = wrapper.find('[data-testid="service-row"]');
  assert.ok(row.classes().includes('state-running'));
  assert.equal(row.attributes('data-state'), 'running');
});

test('ServiceHealthBar color-codes stopped services red', () => {
  const wrapper = mount(ServiceHealthBar, {
    props: { services: [{ service_name: 'Svc', state: 'Stopped', start_mode: 'Disabled' }] }
  });
  const row = wrapper.find('[data-testid="service-row"]');
  assert.ok(row.classes().includes('state-stopped'));
  assert.equal(row.attributes('data-state'), 'stopped');
});

test('ServiceHealthBar color-codes start_pending services as starting (yellow)', () => {
  const wrapper = mount(ServiceHealthBar, {
    props: { services: [{ service_name: 'Svc', state: 'Start_Pending', start_mode: 'Auto' }] }
  });
  const row = wrapper.find('[data-testid="service-row"]');
  assert.ok(row.classes().includes('state-starting'));
  assert.equal(row.attributes('data-state'), 'starting');
});

test('ServiceHealthBar falls back to unknown state for unrecognized values', () => {
  const wrapper = mount(ServiceHealthBar, {
    props: { services: [{ service_name: 'Svc', state: 'WeirdValue', start_mode: '' }] }
  });
  const row = wrapper.find('[data-testid="service-row"]');
  assert.ok(row.classes().includes('state-unknown'));
  assert.equal(row.attributes('data-state'), 'unknown');
});

test('ServiceHealthBar includes start_mode in the visible row', () => {
  const wrapper = mount(ServiceHealthBar, {
    props: { services: [{ service_name: 'Svc', state: 'Running', start_mode: 'Manual' }] }
  });
  assert.ok(wrapper.text().includes('Manual'));
});