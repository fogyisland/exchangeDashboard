<template>
  <div class="metric-dashboard" data-testid="metric-dashboard">
    <header class="view-header">
      <h2>Metric Dashboards</h2>
      <div class="actions">
        <label class="package-select">
          Package
          <select v-model="packageName" :disabled="loadingPackages">
            <option value="">-- select package --</option>
            <option v-for="p in packageOptions" :key="p.name || p.id" :value="p.name || p.id">
              {{ p.name || p.id }}
            </option>
          </select>
        </label>
        <button type="button" class="refresh" @click="loadAll" :disabled="!packageName || loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="loadingPackages" class="muted">Loading packages...</p>
    <p v-else-if="!packageName && !loadingPackages" class="muted">
      Select a package to view its metric dashboard.
    </p>
    <p v-else-if="loading && tiles.length === 0 && timeseries.length === 0" class="muted">
      Loading metrics...
    </p>

    <section v-if="packageName" class="dashboard-content" data-testid="dashboard-content">
      <section v-if="tiles.length" class="tiles-grid">
        <CounterTile
          v-for="t in counterTiles"
          :key="`c-${t.id}`"
          :label="t.label"
          :value="t.value"
          :unit="t.unit"
          :delta="t.delta"
        />
        <StatusTile
          v-for="t in statusTiles"
          :key="`s-${t.id}`"
          :status="t.status"
          :label="t.label"
          :message="t.message"
        />
        <GaugeTile
          v-for="t in gaugeTiles"
          :key="`g-${t.id}`"
          :label="t.label"
          :value="t.value"
          :min="t.min"
          :max="t.max"
          :unit="t.unit"
          :severity="t.severity"
        />
      </section>

      <section v-if="timeseries.length" class="timeseries-grid">
        <TimeseriesTile
          v-for="ts in timeseries"
          :key="`ts-${ts.metricId}`"
          :label="ts.label"
          :unit="ts.unit"
          :points="ts.points"
        />
      </section>

      <p v-if="!loading && tiles.length === 0 && timeseries.length === 0" class="empty">
        No metrics available for this package.
      </p>
    </section>

    <p v-if="error" class="err">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { usePackagesStore } from '../stores/packages.js';
import * as dashboardApi from '../api/dashboard.js';
import CounterTile from '../components/metrics/CounterTile.vue';
import StatusTile from '../components/metrics/StatusTile.vue';
import GaugeTile from '../components/metrics/GaugeTile.vue';
import TimeseriesTile from '../components/metrics/TimeseriesTile.vue';

const packages = usePackagesStore();

const packageName = ref('');
const summary = ref(null);
const tiles = ref([]);
const timeseries = ref([]);

const loading = ref(false);
const error = ref('');

const packageOptions = computed(() => packages.installed);
const loadingPackages = computed(() => packages.loading);

const counterTiles = computed(() => tiles.value.filter((t) => t.kind === 'counter'));
const statusTiles = computed(() => tiles.value.filter((t) => t.kind === 'status'));
const gaugeTiles = computed(() => tiles.value.filter((t) => t.kind === 'gauge'));

// Normalize API summary response into a flat list of tile descriptors.
// Accepted shapes:
//   { counters: [{id,label,unit,value,delta?}], statuses: [...], gauges: [...] }
//   { tiles: [...] } (flat list of tile descriptors)
//   { metrics: [{id,label,unit,value,kind,severity?,min?,max?,delta?,message?}] }
function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'object') return { tiles: [], timeseries: [] };
  if (Array.isArray(raw.tiles)) {
    return { tiles: raw.tiles, timeseries: Array.isArray(raw.timeseries) ? raw.timeseries : [] };
  }
  if (Array.isArray(raw.metrics)) {
    return { tiles: raw.metrics, timeseries: Array.isArray(raw.timeseries) ? raw.timeseries : [] };
  }
  const tilesOut = [];
  if (Array.isArray(raw.counters)) {
    for (const c of raw.counters) {
      tilesOut.push({
        kind: 'counter',
        id: c.id || c.metricId || c.label,
        label: c.label || c.id || c.metricId || '',
        unit: c.unit || '',
        value: c.value ?? null,
        delta: c.delta ?? null
      });
    }
  }
  if (Array.isArray(raw.statuses)) {
    for (const s of raw.statuses) {
      tilesOut.push({
        kind: 'status',
        id: s.id || s.metricId || s.label,
        label: s.label || s.id || s.metricId || '',
        status: s.status || s.value || 'unknown',
        message: s.message || s.detail || ''
      });
    }
  }
  if (Array.isArray(raw.gauges)) {
    for (const g of raw.gauges) {
      tilesOut.push({
        kind: 'gauge',
        id: g.id || g.metricId || g.label,
        label: g.label || g.id || g.metricId || '',
        unit: g.unit || '',
        value: g.value ?? null,
        min: typeof g.min === 'number' ? g.min : 0,
        max: typeof g.max === 'number' ? g.max : 100,
        severity: g.severity || 'ok'
      });
    }
  }
  return { tiles: tilesOut, timeseries: Array.isArray(raw.timeseries) ? raw.timeseries : [] };
}

async function loadPackages() {
  try {
    await packages.fetchInstalled();
  } catch {
    // error already stored on the store
  }
}

async function loadSummary() {
  if (!packageName.value) return;
  summary.value = null;
  tiles.value = [];
  try {
    const data = await dashboardApi.metricsSummary(packageName.value);
    summary.value = data;
    const norm = normalizeSummary(data);
    tiles.value = norm.tiles;
  } catch (e) {
    tiles.value = [];
    error.value = e?.response?.data?.error?.message || e?.message || 'Failed to load metrics summary';
  }
}

async function loadTimeseries() {
  if (!packageName.value) return;
  timeseries.value = [];
  // Try to load timeseries for each counter/gauge tile's underlying metric id.
  const candidates = [];
  for (const t of tiles.value) {
    if (t.id && !candidates.includes(t.id)) candidates.push(t.id);
  }
  if (candidates.length === 0) return;
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const to = now.toISOString();
  const results = [];
  for (const metricId of candidates) {
    try {
      const data = await dashboardApi.metricsTimeseries({ metricId, from, to });
      const points = Array.isArray(data?.points) ? data.points : Array.isArray(data) ? data : [];
      const tile = tiles.value.find((t) => t.id === metricId);
      results.push({
        metricId,
        label: tile?.label || metricId,
        unit: tile?.unit || '',
        points
      });
    } catch {
      // skip this metric silently — surface summary error only
    }
  }
  timeseries.value = results;
}

async function loadAll() {
  if (!packageName.value) return;
  error.value = '';
  loading.value = true;
  try {
    await loadSummary();
    await loadTimeseries();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadPackages();
});

watch(packageName, () => {
  if (packageName.value) loadAll();
});
</script>

<style scoped>
.metric-dashboard { padding: 8px; }
.metric-dashboard h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.package-select {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
.refresh { padding: 6px 12px; }
.tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.timeseries-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
}
.muted { color: var(--muted); }
.err { color: var(--red, #ef4444); margin-top: 12px; }
.empty {
  color: var(--muted);
  padding: 32px;
  text-align: center;
}
</style>