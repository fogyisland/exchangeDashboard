<template>
  <div class="dag-replication" data-testid="dag-replication-view">
    <header class="view-header">
      <h2>DAG Replication Matrix</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Replication targets
        <span class="meta" v-if="rows.length">{{ rows.length }} entries</span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading replication matrix...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No replication targets configured.</p>
      <table v-else class="matrix-table" data-testid="matrix-table">
        <thead>
          <tr>
            <th>DAG</th>
            <th>Source DB</th>
            <th>Target Server</th>
            <th>Target DB</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in rows"
            :key="row.id ?? `${row.sourceDb}-${row.targetServer}-${idx}`"
            :data-testid="`matrix-row-${idx}`"
          >
            <td>{{ row.dag ?? row.dag_name ?? row.dagName ?? '-' }}</td>
            <td>{{ row.sourceDb ?? row.source_db ?? row.sourceDatabase ?? '-' }}</td>
            <td>{{ row.targetServer ?? row.target_server ?? row.targetServerName ?? '-' }}</td>
            <td>{{ row.targetDb ?? row.target_db ?? row.targetDatabase ?? '-' }}</td>
            <td>{{ row.status ?? row.state ?? '' }}</td>
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

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.dagReplication.list();
    rows.value = data?.rows || data?.matrix || data || [];
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load replication matrix';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dag-replication { padding: 8px; }
.dag-replication h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.matrix-table { width: 100%; border-collapse: collapse; }
.matrix-table th, .matrix-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.matrix-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.refresh { padding: 6px 12px; }
</style>