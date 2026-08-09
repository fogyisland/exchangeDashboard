<template>
  <article class="server-card" data-testid="server-card">
    <header class="card-header">
      <div class="ident">
        <h3 class="hostname" data-testid="server-hostname">
          {{ server.name || server.hostname || ('Server #' + server.id) }}
        </h3>
        <div class="sub" v-if="server.fqdn || server.os_version || server.exchange_version">
          <span v-if="server.fqdn" class="sub-item">{{ server.fqdn }}</span>
          <span v-if="server.os_version" class="sub-item">{{ server.os_version }}</span>
          <span v-if="server.exchange_version" class="sub-item">{{ server.exchange_version }}</span>
        </div>
      </div>
      <div class="status" :class="enabledClass">
        {{ server.enabled ? 'enabled' : 'disabled' }}
      </div>
    </header>

    <div class="meta" data-testid="server-meta">
      <div class="meta-item">
        <span class="meta-label">Last heartbeat</span>
        <span class="meta-value" :class="heartbeatClass" data-testid="server-heartbeat">
          {{ heartbeatLabel }}
        </span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Services</span>
        <span class="meta-value" data-testid="services-summary">
          {{ servicesSummary }}
        </span>
      </div>
    </div>

    <section class="resources" data-testid="resources-section">
      <h4 class="section-title">Resources</h4>
      <div class="resource-grid">
        <div class="resource-tile" :class="cpuClass">
          <div class="resource-label">CPU</div>
          <div class="resource-value" data-testid="cpu-value">
            {{ resources && resources.cpu_pct !== null && resources.cpu_pct !== undefined
                ? Number(resources.cpu_pct).toFixed(1) + ' %'
                : '—' }}
          </div>
        </div>
        <div class="resource-tile">
          <div class="resource-label">Memory free</div>
          <div class="resource-value" data-testid="memory-value">
            {{ resources && resources.memory_available_mb !== null && resources.memory_available_mb !== undefined
                ? formatMb(resources.memory_available_mb)
                : '—' }}
          </div>
        </div>
        <div class="resource-tile" :class="diskClass">
          <div class="resource-label">Disk C free</div>
          <div class="resource-value" data-testid="disk-value">
            {{ resources && resources.disk_c_free_pct !== null && resources.disk_c_free_pct !== undefined
                ? Number(resources.disk_c_free_pct).toFixed(1) + ' %'
                : '—' }}
          </div>
        </div>
        <div class="resource-tile">
          <div class="resource-label">Net</div>
          <div class="resource-value" data-testid="net-value">
            {{ resources && resources.net_bytes_per_sec !== null && resources.net_bytes_per_sec !== undefined
                ? formatBytesPerSec(resources.net_bytes_per_sec)
                : '—' }}
          </div>
        </div>
      </div>
    </section>

    <section class="services" data-testid="services-section">
      <h4 class="section-title">Services</h4>
      <ServiceHealthBar :services="services" />
    </section>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import ServiceHealthBar from './ServiceHealthBar.vue';

const props = defineProps({
  server: {
    type: Object,
    required: true
    // { id, name, hostname, fqdn, os_version, exchange_version, last_heartbeat_at, enabled, ... }
  },
  services: {
    type: Array,
    default: () => []
  },
  resources: {
    type: Object,
    default: null
    // { cpu_pct, memory_available_mb, disk_c_free_pct, net_bytes_per_sec, captured_at }
  }
});

const servicesSummary = computed(() => {
  const total = props.services.length;
  if (total === 0) return '—';
  const running = props.services.filter((s) => {
    const state = String(s.state || '').toLowerCase();
    return state === 'running';
  }).length;
  return `${running}/${total} running`;
});

const enabledClass = computed(() => (props.server.enabled ? 'enabled' : 'disabled'));

const heartbeatLabel = computed(() => {
  const ts = props.server.last_heartbeat_at;
  if (!ts) return '—';
  // Normalize any of: ISO, SQL "YYYY-MM-DD HH:MM:SS", epoch ms.
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('T') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(ts);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return d.toLocaleString();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} d ago`;
});

const heartbeatClass = computed(() => {
  const ts = props.server.last_heartbeat_at;
  if (!ts) return 'hb-stale';
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('T') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return 'hb-stale';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 10) return 'hb-fresh';
  if (mins < 60) return 'hb-warn';
  return 'hb-stale';
});

// CPU thresholds: warn >= 70, crit >= 90
const cpuClass = computed(() => thresholdClass(props.resources?.cpu_pct, 70, 90));
// Disk free thresholds: warn <= 20, crit <= 10 (low free space is bad)
const diskClass = computed(() => {
  const v = props.resources?.disk_c_free_pct;
  if (v === null || v === undefined) return '';
  if (v <= 10) return 'severity-crit';
  if (v <= 20) return 'severity-warn';
  return '';
});

function thresholdClass(value, warn, crit) {
  if (value === null || value === undefined) return '';
  if (value >= crit) return 'severity-crit';
  if (value >= warn) return 'severity-warn';
  return '';
}

function formatMb(mb) {
  const n = Number(mb);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1024) return (n / 1024).toFixed(2) + ' GB';
  return n.toFixed(0) + ' MB';
}

function formatBytesPerSec(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
</script>

<style scoped>
.server-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.ident {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.hostname {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 11px;
}
.sub-item:not(:last-child)::after {
  content: ' · ';
  margin-left: 8px;
  color: var(--muted);
}
.status {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  white-space: nowrap;
  align-self: flex-start;
}
.status.enabled { color: var(--green, #22c55e); border-color: var(--green, #22c55e); }
.status.disabled { color: var(--muted); border-color: var(--border); }

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 12px;
  background: var(--panel-alt, rgba(255, 255, 255, 0.02));
  border-radius: 4px;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
}
.meta-value {
  font-size: 13px;
  color: var(--text);
}
.meta-value.hb-fresh { color: var(--green, #22c55e); }
.meta-value.hb-warn { color: #eab308; }
.meta-value.hb-stale { color: var(--red, #ef4444); }

.section-title {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  font-weight: 600;
}

.resources { display: flex; flex-direction: column; }
.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.resource-tile {
  background: var(--panel-alt, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.resource-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
}
.resource-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.resource-tile.severity-warn { border-color: #eab308; }
.resource-tile.severity-warn .resource-value { color: #eab308; }
.resource-tile.severity-crit { border-color: var(--red, #ef4444); }
.resource-tile.severity-crit .resource-value { color: var(--red, #ef4444); }

.services { display: flex; flex-direction: column; }
</style>