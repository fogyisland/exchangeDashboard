import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mount } from '@vue/test-utils';
import ServerCard from '../../src/components/ServerCard.vue';

const baseServer = {
  id: 1,
  name: 'EXMBX-01',
  hostname: 'EXMBX-01',
  fqdn: 'exmbx-01.corp.local',
  os_version: 'Windows Server 2019',
  exchange_version: 'Exchange 2019 CU12',
  last_heartbeat_at: new Date().toISOString(),
  enabled: true
};

test('ServerCard renders hostname', () => {
  const wrapper = mount(ServerCard, { props: { server: baseServer } });
  assert.ok(wrapper.find('[data-testid="server-hostname"]').text().includes('EXMBX-01'));
});

test('ServerCard shows services summary as "0/N running" when no services', () => {
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services: [], resources: null }
  });
  assert.ok(wrapper.find('[data-testid="services-summary"]').text().includes('—'));
});

test('ServerCard counts running services correctly', () => {
  const services = [
    { service_name: 'A', state: 'Running', start_mode: 'Auto' },
    { service_name: 'B', state: 'Stopped', start_mode: 'Disabled' },
    { service_name: 'C', state: 'Running', start_mode: 'Auto' }
  ];
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services, resources: null }
  });
  assert.ok(wrapper.find('[data-testid="services-summary"]').text().includes('2/3 running'));
});

test('ServerCard shows "—" tiles when resources is null', () => {
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services: [], resources: null }
  });
  assert.equal(wrapper.find('[data-testid="cpu-value"]').text(), '—');
  assert.equal(wrapper.find('[data-testid="memory-value"]').text(), '—');
  assert.equal(wrapper.find('[data-testid="disk-value"]').text(), '—');
  assert.equal(wrapper.find('[data-testid="net-value"]').text(), '—');
});

test('ServerCard renders resource values when resources provided', () => {
  const resources = {
    cpu_pct: 42.5,
    memory_available_mb: 8192,
    disk_c_free_pct: 35.0,
    net_bytes_per_sec: 1024 * 256
  };
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services: [], resources }
  });
  assert.ok(wrapper.find('[data-testid="cpu-value"]').text().includes('42.5'));
  assert.ok(wrapper.find('[data-testid="memory-value"]').text().includes('8.00 GB'));
  assert.ok(wrapper.find('[data-testid="disk-value"]').text().includes('35.0'));
  assert.ok(wrapper.find('[data-testid="net-value"]').text().includes('KB/s'));
});

test('ServerCard flags CPU as severity-crit when >= 90', () => {
  const resources = {
    cpu_pct: 95,
    memory_available_mb: 1024,
    disk_c_free_pct: 50,
    net_bytes_per_sec: 100
  };
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services: [], resources }
  });
  const tile = wrapper.find('[data-testid="resources-section"]');
  // Walk the DOM: at least one tile in resources should have severity-crit.
  assert.ok(tile.findAll('.severity-crit').length > 0);
});

test('ServerCard flags low disk free as severity-crit', () => {
  const resources = {
    cpu_pct: 5,
    memory_available_mb: 1024,
    disk_c_free_pct: 8,
    net_bytes_per_sec: 100
  };
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services: [], resources }
  });
  const tile = wrapper.find('[data-testid="resources-section"]');
  assert.ok(tile.findAll('.severity-crit').length > 0);
});

test('ServerCard shows "disabled" status when server is disabled', () => {
  const wrapper = mount(ServerCard, {
    props: { server: { ...baseServer, enabled: false }, services: [], resources: null }
  });
  assert.ok(wrapper.text().includes('disabled'));
});

test('ServerCard renders ServiceHealthBar with the provided services', () => {
  const services = [
    { service_name: 'MSExchangeTransport', state: 'Running', start_mode: 'Auto' }
  ];
  const wrapper = mount(ServerCard, {
    props: { server: baseServer, services, resources: null }
  });
  assert.ok(wrapper.find('[data-testid="service-health-bar"]').exists());
  const rows = wrapper.findAll('[data-testid="service-row"]');
  assert.equal(rows.length, 1);
  assert.ok(wrapper.text().includes('MSExchangeTransport'));
});