<template>
  <div class="mailflow">
    <h2>Mail Flow</h2>

    <div class="filters">
      <label>
        Time window
        <select v-model="timeWindow">
          <option v-for="opt in timeWindowOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label>
        Server
        <select v-model="serverId">
          <option value="all">All</option>
          <option v-for="s in serverOptions" :key="s.id" :value="String(s.id)">
            {{ s.name || s.hostname || ('#' + s.id) }}
          </option>
        </select>
      </label>
      <button type="button" class="refresh" @click="loadAll" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </div>

    <section class="panel">
      <header class="panel-header">
        <span>Current Queue Snapshots</span>
        <span class="meta" v-if="currentRows.length">{{ currentRows.length }} queues</span>
      </header>
      <QueueTable :rows="currentRows" :loading="loadingCurrent" />
    </section>

    <section class="panel">
      <header class="panel-header">
        <span>Queue History</span>
        <span class="meta" v-if="chartPoints.length">
          {{ chartPoints.length }} points
        </span>
      </header>
      <p v-if="!chartPoints.length && !loadingHistory" class="muted">
        No history for selected window. Choose a single server to view per-kind history.
      </p>
      <p v-else-if="loadingHistory" class="muted">Loading history...</p>
      <QueueChart v-else :points="chartPoints" />
    </section>

    <section class="panel">
      <header class="panel-header">
        <span>Stuck Messages</span>
        <span class="meta" v-if="stuckRows.length">{{ stuckRows.length }} alerts</span>
      </header>
      <StuckMessagesPanel :rows="stuckRows" :loading="loadingStuck" />
    </section>

    <p v-if="error" class="err">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import api from '../api/client.js';
import QueueTable from '../components/QueueTable.vue';
import QueueChart from '../components/QueueChart.vue';
import StuckMessagesPanel from '../components/StuckMessagesPanel.vue';

const timeWindowOptions = [
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' }
];

const timeWindow = ref('1h');
const serverId = ref('all');

const currentRows = ref([]);
const stuckRows = ref([]);
const chartPoints = ref([]);
const serverOptions = ref([]);

const loadingCurrent = ref(false);
const loadingStuck = ref(false);
const loadingHistory = ref(false);
const loadingServers = ref(false);
const error = ref('');

const anyLoading = computed(
  () => loadingCurrent.value || loadingStuck.value || loadingHistory.value || loadingServers.value
);
const loading = anyLoading;

function windowMs(value) {
  switch (value) {
    case '1h': return 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    default: return 60 * 60 * 1000;
  }
}

function rangeBounds(value) {
  const to = new Date();
  const from = new Date(to.getTime() - windowMs(value));
  return { from: from.toISOString(), to: to.toISOString() };
}

async function loadServers() {
  loadingServers.value = true;
  try {
    const data = await api.get('/api/servers').then((r) => r.data);
    serverOptions.value = data?.servers || data || [];
  } catch (e) {
    // tolerate — server list is optional
    serverOptions.value = [];
    if (e?.response?.status !== 401) {
      // ignore other errors
    }
  } finally {
    loadingServers.value = false;
  }
}

async function loadCurrent() {
  loadingCurrent.value = true;
  try {
    const params = serverId.value === 'all' ? {} : { serverId: Number(serverId.value) };
    const data = await api.get('/api/queues/current', { params }).then((r) => r.data);
    currentRows.value = data?.queues || data || [];
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load queues';
  } finally {
    loadingCurrent.value = false;
  }
}

async function loadHistory() {
  if (serverId.value === 'all') {
    chartPoints.value = [];
    return;
  }
  loadingHistory.value = true;
  try {
    const { from, to } = rangeBounds(timeWindow.value);
    // Collect per-queue_kind history. Mailflow API supports single queue_kind
    // so we union the most common queue kinds.
    const kinds = ['ActiveMailboxDelivery', 'Submission', 'Poison', 'Retry', 'Unreachable', 'Shadow', 'SafetyNet'];
    const all = [];
    for (const k of kinds) {
      try {
        const params = {
          serverId: Number(serverId.value),
          queueKind: k,
          from,
          to
        };
        const r = await api.get('/api/queues/history', { params }).then((rr) => rr.data);
        const points = r?.points || r || [];
        if (Array.isArray(points)) all.push(...points);
      } catch {
        /* skip kind */
      }
    }
    chartPoints.value = all;
  } catch (e) {
    chartPoints.value = [];
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load history';
  } finally {
    loadingHistory.value = false;
  }
}

async function loadStuck() {
  loadingStuck.value = true;
  try {
    const data = await api.get('/api/queues/stuck').then((r) => r.data);
    stuckRows.value = data?.rows || data || [];
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load stuck';
  } finally {
    loadingStuck.value = false;
  }
}

async function loadAll() {
  error.value = '';
  await Promise.all([loadCurrent(), loadHistory(), loadStuck()]);
}

onMounted(async () => {
  await loadServers();
  await loadAll();
});

watch(timeWindow, () => loadHistory());
watch(serverId, () => {
  loadCurrent();
  loadHistory();
});
</script>

<style scoped>
.mailflow { padding: 8px; }
.mailflow h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.filters {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 16px;
  background: var(--panel);
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.filters label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 13px; }
.refresh { align-self: stretch; }
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
}
.panel-header .meta { color: var(--muted); font-weight: 400; font-size: 12px; }
.muted { color: var(--muted); }
.err { color: var(--red); margin-top: 12px; }
</style>
