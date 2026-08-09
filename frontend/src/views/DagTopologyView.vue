<template>
  <div class="dag-topology-view">
    <header class="view-header">
      <h2>DAG Topology</h2>
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
        <router-link class="grid-link" to="/dag/grid">Grid view</router-link>
      </div>
    </header>

    <section class="panel">
      <header class="panel-header">
        <span>Topology</span>
        <span class="meta" v-if="members.length">{{ members.length }} members</span>
      </header>
      <p v-if="!dagId" class="muted">Select a DAG to view its topology.</p>
      <p v-else-if="loadingTopology" class="muted">Loading topology...</p>
      <DagTopologyChart
        v-else
        :members="members"
        @server-click="onServerClick"
      />
    </section>

    <section v-if="selectedServerId !== null" class="panel">
      <header class="panel-header">
        <span>Server #{{ selectedServerId }} — Copy Status Drill-down</span>
        <button type="button" class="close" @click="selectedServerId = null">Close</button>
      </header>
      <table v-if="filteredCopies.length" class="drilldown">
        <thead>
          <tr>
            <th>DB</th>
            <th>Queue Length</th>
            <th>Replay Lag (s)</th>
            <th>Mount</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredCopies" :key="row.db_id">
            <td>{{ row.db_name || row.db_id }}</td>
            <td>{{ row.copy_queue_length ?? row.copyQueueLength ?? '-' }}</td>
            <td>{{ row.replay_lag_seconds ?? row.replayLagSeconds ?? '-' }}</td>
            <td>{{ mountLabel(row.mount_status ?? row.mountStatus) }}</td>
            <td>{{ (row.is_active_copy ?? row.isActiveCopy ?? 0) ? 'Yes' : 'No' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">No copy status for this server.</p>
    </section>

    <section class="panel">
      <header class="panel-header">
        <span>Database / Server Grid</span>
        <span class="meta" v-if="databases.length">{{ uniqueDbCount }} databases / {{ uniqueServerCount }} servers</span>
      </header>
      <DagGrid :databases="databases" :copy-status="mergedCopyStatus" />
    </section>

    <p v-if="error" class="err">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import * as dagApi from '../api/dag.js';
import DagTopologyChart from '../components/DagTopologyChart.vue';
import DagGrid from '../components/DagGrid.vue';

const dagOptions = ref([]);
const dagId = ref('');
const members = ref([]);
const databases = ref([]);
const copyStatusByDb = ref({}); // db_id -> copies
const loadingDags = ref(false);
const loadingTopology = ref(false);
const loadingDatabases = ref(false);
const loadingCopies = ref(false);
const error = ref('');
const selectedServerId = ref(null);

const loading = computed(
  () => loadingTopology.value || loadingDatabases.value || loadingCopies.value
);

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

const filteredCopies = computed(() => {
  const list = mergedCopyStatus.value.filter(
    (c) => Number(c.server_id ?? c.serverId) === Number(selectedServerId.value)
  );
  // Join with db_name for nicer display
  const dbById = new Map(
    databases.value.map((d) => [Number(d.server_id ?? d.serverId) + ':' + (d.db_id ?? d.dbId), d])
  );
  return list.map((c) => {
    const serverId = Number(c.server_id ?? c.serverId);
    const dbId = c.db_id ?? c.dbId;
    const joined = dbById.get(serverId + ':' + dbId);
    return joined ? { ...c, db_name: joined.db_name || joined.dbName } : c;
  });
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

async function loadTopology(id) {
  loadingTopology.value = true;
  try {
    const data = await dagApi.topology(id);
    members.value = data?.members || [];
  } catch (e) {
    members.value = [];
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load topology';
  } finally {
    loadingTopology.value = false;
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
  selectedServerId.value = null;
  // Topology and databases can load in parallel; copies depend on databases.
  await Promise.all([loadTopology(dagId.value), loadDatabases(dagId.value)]);
  await loadAllCopies(dagId.value);
}

function onServerClick(serverId) {
  selectedServerId.value = Number(serverId);
}

function mountLabel(status) {
  const n = Number(status);
  if (n === 1) return 'Mounted';
  if (n === 0) return 'Dismounted';
  return 'Unknown';
}

onMounted(async () => {
  await loadDags();
});

watch(dagId, (val) => {
  if (val) loadAll();
});
</script>

<style scoped>
.dag-topology-view { padding: 8px; }
.dag-topology-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.grid-link { color: var(--accent); font-size: 13px; text-decoration: none; padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; }
.grid-link:hover { border-color: var(--accent); }
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
.close { background: transparent; border: 1px solid var(--border); color: var(--muted); padding: 2px 8px; font-size: 12px; border-radius: 4px; }
.close:hover { color: var(--text); border-color: var(--accent); }
.drilldown { width: 100%; border-collapse: collapse; }
.drilldown th, .drilldown td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; font-size: 13px; }
.drilldown th { color: var(--muted); font-weight: 600; }
.muted { color: var(--muted); }
.err { color: var(--red); margin-top: 12px; }
</style>