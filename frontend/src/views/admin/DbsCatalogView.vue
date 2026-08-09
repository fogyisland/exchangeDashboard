<template>
  <div class="dbs-catalog" data-testid="dbs-catalog-view">
    <header class="view-header">
      <h2>Database Catalog</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Mailbox databases (mdb_catalog)
        <span class="meta" v-if="rows.length">{{ rows.length }} databases</span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading databases...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No databases in catalog.</p>
      <table v-else class="dbs-table" data-testid="dbs-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Server</th>
            <th>DAG</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id ?? row.name" :data-testid="`db-row-${row.name}`">
            <td class="name-cell">{{ row.name ?? row.db_name ?? row.dbName }}</td>
            <td>{{ row.server ?? row.server_name ?? row.serverName ?? '-' }}</td>
            <td>{{ row.dag ?? row.dag_name ?? row.dagName ?? '-' }}</td>
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
    const data = await adminApi.dbs.list();
    rows.value = data?.databases || data?.rows || data?.dbs || data || [];
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load databases';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dbs-catalog { padding: 8px; }
.dbs-catalog h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.dbs-table { width: 100%; border-collapse: collapse; }
.dbs-table th, .dbs-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.dbs-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.name-cell { font-weight: 600; color: var(--accent); }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.refresh { padding: 6px 12px; }
</style>