<template>
  <div class="client-access">
    <header class="view-header">
      <h2>Client Access</h2>
      <div class="actions">
        <label class="server-select">
          Server
          <select v-model="serverId" :disabled="loadingServers">
            <option value="">-- select server --</option>
            <option v-for="s in serverOptions" :key="s.id" :value="String(s.id)">
              {{ s.name || s.hostname || ('#' + s.id) }}
            </option>
          </select>
        </label>
        <button type="button" class="refresh" @click="loadAll" :disabled="!serverId || loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="!serverId && !loadingServers" class="muted">
      Select a server to view its client access metrics.
    </p>
    <p v-else-if="loadingServers" class="muted">Loading servers...</p>

    <section v-else class="grid" data-testid="tiles-grid">
      <ClientAccessTile
        title="RPC Avg Latency"
        unit="ms"
        :value="metricValue('RpcClientAccess.AverageLatency')"
        :threshold="{ warn: 25, crit: 50 }"
        :sparkline="latencyHistory"
      />
      <ClientAccessTile
        title="RPC Active Users"
        :value="metricValue('RpcClientAccess.ActiveUsers')"
      />
      <ClientAccessTile
        title="ActiveSync Requests/sec"
        unit="req/s"
        :value="metricValue('ActiveSync.RequestsPerSec')"
      />
      <ClientAccessTile
        title="ActiveSync Avg Command Time"
        unit="ms"
        :value="metricValue('ActiveSync.AvgCmdTime')"
        :threshold="{ warn: 200, crit: 500 }"
      />
      <ClientAccessTile
        title="MAPI/HTTP Avg Request Time"
        unit="ms"
        :value="metricValue('MapiHttp.AvgRequestTime')"
        :threshold="{ warn: 200, crit: 500 }"
      />
      <ClientAccessTile
        title="Outlook Anywhere RPC Time"
        unit="ms"
        :value="metricValue('OutlookAnywhere.AvgRpcResponseTime')"
        :threshold="{ warn: 500, crit: 1000 }"
      />
    </section>

    <p v-if="error" class="err">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { list as listServers } from '../api/servers.js';
import * as clientAccessApi from '../api/clientAccess.js';
import ClientAccessTile from '../components/ClientAccessTile.vue';

const serverId = ref('');
const serverOptions = ref([]);
const summaryRows = ref([]);
const perServerRows = ref([]);
const latencyRows = ref([]);

const loadingServers = ref(false);
const loadingSummary = ref(false);
const loadingPerServer = ref(false);
const loadingLatency = ref(false);
const error = ref('');

const loading = computed(
  () => loadingSummary.value || loadingPerServer.value || loadingLatency.value
);

function normalizeRows(raw) {
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw)) return raw;
  return [];
}

function metricLookup(rows) {
  // Build map: metric -> value for the currently selected server
  const map = {};
  const sid = Number(serverId.value);
  if (!sid) return map;
  for (const r of rows) {
    if (Number(r.server_id ?? r.serverId) !== sid) continue;
    const m = r.metric;
    if (!m) continue;
    const v = r.value ?? r.avg_value ?? r.avgValue ?? r.avg_ms ?? r.avgMs;
    if (v !== undefined && v !== null) {
      map[m] = Number(v) || 0;
    }
  }
  return map;
}

const summaryMap = computed(() => metricLookup(summaryRows.value));
const perServerMap = computed(() => metricLookup(perServerRows.value));

// Prefer summary (latest snapshot) for the current value; fall back to per-server 1h average.
function metricValue(name) {
  if (summaryMap.value[name] !== undefined) return summaryMap.value[name];
  if (perServerMap.value[name] !== undefined) return perServerMap.value[name];
  return null;
}

const latencyHistory = computed(() => {
  // /latency returns a single avg per server (5 min window).
  // The Tile's sparkline supports a single point gracefully, so we pass it as-is.
  const sid = Number(serverId.value);
  if (!sid) return [];
  const row = latencyRows.value.find((r) => Number(r.server_id ?? r.serverId) === sid);
  if (!row) return [];
  const v = Number(row.avg_ms ?? row.avgMs);
  return Number.isFinite(v) ? [v] : [];
});

async function loadServers() {
  loadingServers.value = true;
  try {
    const data = await listServers();
    serverOptions.value = data?.servers || data || [];
  } catch (e) {
    serverOptions.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load servers';
    }
  } finally {
    loadingServers.value = false;
  }
}

async function loadSummary() {
  loadingSummary.value = true;
  try {
    const data = await clientAccessApi.summary();
    summaryRows.value = normalizeRows(data);
  } catch (e) {
    summaryRows.value = [];
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load summary';
  } finally {
    loadingSummary.value = false;
  }
}

async function loadPerServer() {
  loadingPerServer.value = true;
  try {
    const data = await clientAccessApi.perServer();
    perServerRows.value = normalizeRows(data);
  } catch (e) {
    perServerRows.value = [];
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load per-server';
  } finally {
    loadingPerServer.value = false;
  }
}

async function loadLatency() {
  loadingLatency.value = true;
  try {
    const data = await clientAccessApi.latency();
    latencyRows.value = normalizeRows(data);
  } catch (e) {
    latencyRows.value = [];
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load latency';
  } finally {
    loadingLatency.value = false;
  }
}

async function loadAll() {
  if (!serverId.value) return;
  error.value = '';
  await Promise.all([loadSummary(), loadPerServer(), loadLatency()]);
}

onMounted(async () => {
  await loadServers();
});

watch(serverId, (val) => {
  if (val) loadAll();
});
</script>

<style scoped>
.client-access { padding: 8px; }
.client-access h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  background: var(--panel);
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.actions { display: flex; gap: 12px; align-items: flex-end; }
.server-select { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
.refresh { padding: 6px 12px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.muted { color: var(--muted); }
.err { color: var(--red, #ef4444); margin-top: 12px; }
</style>
