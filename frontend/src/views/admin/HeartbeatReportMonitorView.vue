<template>
  <div class="heartbeat-monitor" data-testid="heartbeat-monitor-view">
    <header class="view-header">
      <h2>Heartbeat Report Monitor</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Offline or stale agents
        <span class="meta" v-if="rows.length">{{ rows.length }} agents</span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading agents...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">All agents are reporting.</p>
      <table v-else class="hb-table" data-testid="hb-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Server</th>
            <th>Last heartbeat</th>
            <th>Stale (s)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in rows"
            :key="row.agentId ?? row.agent_id ?? idx"
            :data-testid="`hb-row-${idx}`"
          >
            <td class="muted-cell">{{ row.agentId ?? row.agent_id ?? row.agent ?? '-' }}</td>
            <td>{{ row.server ?? row.server_name ?? row.serverName ?? row.hostname ?? '-' }}</td>
            <td class="muted-cell">{{ formatDate(row.lastHeartbeatAt ?? row.last_heartbeat_at ?? row.lastSeen ?? row.last_seen) }}</td>
            <td>{{ row.staleSeconds ?? row.stale_seconds ?? row.stale ?? '' }}</td>
            <td>
              <span :class="['status-pill', row.offline || row.stale ? 'off' : 'on']">
                {{ row.offline || row.stale ? 'stale' : 'ok' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as heartbeatReportApi from '../../api/heartbeatReport.js';

const rows = ref([]);
const loading = ref(false);
const error = ref('');

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return String(value);
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await heartbeatReportApi.list();
    rows.value = data?.agents || data?.rows || data || [];
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load agents';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.heartbeat-monitor { padding: 8px; }
.heartbeat-monitor h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; background: var(--panel); padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 6px;
}
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; }
.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--muted);
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
}
.meta { font-size: 11px; color: var(--muted); }
.hb-table { width: 100%; border-collapse: collapse; }
.hb-table th, .hb-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.hb-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.muted-cell { color: var(--muted); font-family: monospace; font-size: 12px; }
.status-pill {
  padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.status-pill.on { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill.off { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.refresh { padding: 6px 12px; }
</style>