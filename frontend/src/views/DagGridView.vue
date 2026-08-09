<template>
  <div class="dag-grid-view">
    <header class="view-header">
      <h2>DAG Grid</h2>
      <div class="actions">
        <label class="dag-select">
          DAG
          <select v-model="dagId" :disabled="loadingDags">
            <option value="">-- select DAG --</option>
            <option v-for="dag in dagOptions" :key="dag.id" :value="String(dag.id)">
              {{ dag.name }}
            </option>
          </select>
        </label>
        <button type="button" class="refresh" @click="loadAll" :disabled="!dagId || loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
        <router-link class="topo-link" to="/dag">Topology view</router-link>
      </div>
    </header>

    <section class="panel">
      <header class="panel-header">
        <span>Database / Server Grid</span>
        <span class="meta" v-if="databases.length">{{ uniqueDbCount }} databases / {{ uniqueServerCount }} servers</span>
      </header>
      <p v-if="!dagId" class="muted">Select a DAG to view its grid.</p>
      <p v-else-if="loading" class="muted">Loading...</p>
      <DagGrid v-else :databases="databases" :copy-status="mergedCopyStatus" />
    </section>

    <p v-if="error" class="err">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import * as dagApi from '../api/dag.js';
import DagGrid from '../components/DagGrid.vue';

const dagOptions = ref([]);
const dagId = ref('');
const databases = ref([]);
const copyStatusByDb = ref({});
const loadingDags = ref(false);
const loadingDatabases = ref(false);
const loadingCopies = ref(false);
const error = ref('');

const loading = computed(() => loadingDatabases.value || loadingCopies.value);

const uniqueDbCount = computed(() => {
  const s = new Set(databases.value.map((d) => d.db_name || d.dbName));
  return s.size;
});
const uniqueServerCount = computed(() => {
  const s = new Set(databases.value.map((d) => Number(d.server_id ?? d.serverId)));
  return s.size;
});

const mergedCopyStatus = computed(() => {
  const out = [];
  for (const arr of Object.values(copyStatusByDb.value)) {
    if (Array.isArray(arr)) out.push(...arr);
  }
  return out;
});

async function loadDags() {
  loadingDags.value = true;
  try {
    const data = await dagApi.list();
    dagOptions.value = data?.dags || data || [];
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load DAGs';
  } finally {
    loadingDags.value = false;
  }
}

async function loadDatabases(id) {
  loadingDatabases.value = true;
  try {
    const data = await dagApi.databases(id);
    databases.value = data?.databases || [];
  } catch (e) {
    databases.value = [];
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load databases';
  } finally {
    loadingDatabases.value = false;
  }
}

async function loadAllCopies(id) {
  loadingCopies.value = true;
  copyStatusByDb.value = {};
  try {
    const dbs = databases.value;
    const results = await Promise.all(
      dbs.map(async (d) => {
        const dbId = d.db_id ?? d.dbId;
        try {
          const data = await dagApi.copyStatus(id, dbId);
          return { dbId, copies: data?.copies || [] };
        } catch {
          return { dbId, copies: [] };
        }
      })
    );
    const map = {};
    for (const r of results) map[r.dbId] = r.copies;
    copyStatusByDb.value = map;
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load copy status';
  } finally {
    loadingCopies.value = false;
  }
}

async function loadAll() {
  error.value = '';
  if (!dagId.value) return;
  await loadDatabases(dagId.value);
  await loadAllCopies(dagId.value);
}

onMounted(async () => {
  await loadDags();
});

watch(dagId, (val) => {
  if (val) loadAll();
});
</script>

<style scoped>
.dag-grid-view { padding: 8px; }
.dag-grid-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.actions { display: flex; gap: 12px; align-items: center; }
.dag-select { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
.refresh { padding: 6px 12px; }
.topo-link { color: var(--accent); font-size: 13px; text-decoration: none; padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; }
.topo-link:hover { border-color: var(--accent); }
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