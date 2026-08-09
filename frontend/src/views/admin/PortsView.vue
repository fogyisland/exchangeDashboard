<template>
  <div class="ports-view" data-testid="ports-view">
    <header class="view-header">
      <h2>Port Probes</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Latest probe results
        <span class="meta" v-if="rows.length">{{ rows.length }} entries</span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading probe results...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No probe results yet.</p>
      <table v-else class="ports-table" data-testid="ports-table">
        <thead>
          <tr>
            <th>Server</th>
            <th>Target</th>
            <th>Port</th>
            <th>Status</th>
            <th>Captured</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in rows"
            :key="row.id ?? `${row.server}-${row.host}-${row.port}-${idx}`"
            :data-testid="`port-row-${idx}`"
          >
            <td>{{ row.server ?? row.server_name ?? row.serverName ?? row.hostname ?? '-' }}</td>
            <td>{{ row.host ?? row.target ?? row.address ?? '-' }}</td>
            <td>{{ row.port ?? '-' }}</td>
            <td>
              <span :class="['status-pill', isUp(row) ? 'on' : 'off']">
                {{ isUp(row) ? 'open' : 'closed' }}
              </span>
            </td>
            <td class="muted-cell">{{ formatDate(row.captured_at ?? row.capturedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as adminApi from '../../api/admin.js';

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

function isUp(row) {
  if (row.open === true) return true;
  if (row.open === false) return false;
  const s = String(row.status ?? '').toLowerCase();
  return s === 'open' || s === 'up' || s === 'ok' || s === 'success';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.ports.probe();
    rows.value = data?.rows || data?.results || data?.probes || data || [];
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load probe results';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.ports-view { padding: 8px; }
.ports-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.ports-table { width: 100%; border-collapse: collapse; }
.ports-table th, .ports-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.ports-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.muted-cell { color: var(--muted); font-family: monospace; font-size: 12px; width: 170px; }
.status-pill {
  padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.status-pill.on { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill.off { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.refresh { padding: 6px 12px; }
</style>