<template>
  <div class="migrations-view" data-testid="migrations-view">
    <header class="view-header">
      <h2>Schema Migrations</h2>
      <div class="actions">
        <button
          type="button"
          class="primary"
          @click="apply"
          :disabled="applying"
          data-testid="migrations-apply"
        >
          {{ applying ? 'Applying...' : 'Apply pending' }}
        </button>
        <button type="button" class="refresh" @click="load" :disabled="loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>
    <p v-if="successMsg" class="ok">{{ successMsg }}</p>

    <section class="panel">
      <header class="panel-header">
        Migrations
        <span class="meta" v-if="rows.length">
          {{ rows.length }} total &middot;
          <span :class="{ alert: pendingCount > 0 }">{{ pendingCount }} pending</span>
        </span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading migrations...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No migrations registered.</p>
      <table v-else class="migrations-table" data-testid="migrations-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Description</th>
            <th>Status</th>
            <th>Applied</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id ?? row.name" :data-testid="`migration-row-${row.id ?? row.name}`">
            <td><code>{{ row.id ?? row.name }}</code></td>
            <td>{{ row.description ?? row.name ?? '' }}</td>
            <td>
              <span :class="['status-pill', row.applied ? 'on' : 'off']">
                {{ row.applied ? 'applied' : 'pending' }}
              </span>
            </td>
            <td class="muted-cell">{{ formatDate(row.applied_at ?? row.appliedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import * as migrationsApi from '../../api/migrations.js';

const rows = ref([]);
const loading = ref(false);
const applying = ref(false);
const error = ref('');
const successMsg = ref('');

const pendingCount = computed(() =>
  rows.value.filter((r) => !r.applied).length
);

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return String(value);
  }
}

function normalize(data) {
  if (Array.isArray(data?.migrations)) return data.migrations;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data)) return data;
  return [];
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await migrationsApi.list();
    rows.value = normalize(data).map((r) => ({
      id: r.id ?? r.migration_id ?? r.migrationId ?? r.name,
      description: r.description ?? '',
      applied: !!(r.applied ?? r.applied_at ?? r.appliedAt),
      applied_at: r.applied_at ?? r.appliedAt ?? null
    }));
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load migrations';
    }
  } finally {
    loading.value = false;
  }
}

async function apply() {
  applying.value = true;
  error.value = '';
  successMsg.value = '';
  try {
    const result = await migrationsApi.apply();
    const applied = result?.applied ?? result?.appliedCount ?? null;
    successMsg.value = applied !== null
      ? `Applied ${applied} migration(s).`
      : 'Apply completed.';
    await load();
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to apply migrations';
  } finally {
    applying.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.migrations-view { padding: 8px; }
.migrations-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; background: var(--panel); padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 6px;
}
.actions { display: flex; gap: 8px; }
.primary {
  background: var(--accent); color: var(--panel); border: none;
  padding: 8px 16px; border-radius: 4px; font-weight: 600; cursor: pointer;
}
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.refresh { padding: 6px 12px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; }
.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--muted);
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
}
.meta { font-size: 11px; color: var(--muted); text-transform: none; letter-spacing: 0; }
.meta .alert { color: var(--red, #ef4444); font-weight: 600; }
.migrations-table { width: 100%; border-collapse: collapse; }
.migrations-table th, .migrations-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.migrations-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.migrations-table code { color: var(--accent); font-size: 12px; }
.muted-cell { color: var(--muted); font-family: monospace; font-size: 12px; width: 170px; }
.status-pill {
  padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.status-pill.on { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill.off { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.ok { color: #22c55e; padding: 8px 16px; margin: 0; }
</style>