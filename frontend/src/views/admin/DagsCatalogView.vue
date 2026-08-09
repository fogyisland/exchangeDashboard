<template>
  <div class="dags-catalog" data-testid="dags-catalog-view">
    <header class="view-header">
      <h2>DAG Catalog</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Database Availability Groups
        <span class="meta" v-if="rows.length">{{ rows.length }} DAGs</span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading DAGs...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No DAGs registered.</p>
      <table v-else class="dags-table" data-testid="dags-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Witness</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id ?? row.name" :data-testid="`dag-row-${row.name}`">
            <td class="name-cell">{{ row.name }}</td>
            <td>{{ formatList(row.members ?? row.memberServers ?? row.servers) }}</td>
            <td>{{ row.witness ?? row.witnessServer ?? '-' }}</td>
            <td>{{ row.notes ?? row.description ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="muted small">
      Future: admin POST to create / edit DAGs will be enabled once the catalog write API ships.
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as adminApi from '../../api/admin.js';

const rows = ref([]);
const loading = ref(false);
const error = ref('');

function formatList(value) {
  if (Array.isArray(value)) return value.join(', ') || '-';
  return value || '-';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.dags.list();
    rows.value = data?.dags || data?.rows || data || [];
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load DAGs';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dags-catalog { padding: 8px; }
.dags-catalog h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.dags-table { width: 100%; border-collapse: collapse; }
.dags-table th, .dags-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.dags-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.name-cell { font-weight: 600; color: var(--accent); }
.muted { color: var(--muted); }
.small { font-size: 12px; padding: 8px 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.refresh { padding: 6px 12px; }
</style>