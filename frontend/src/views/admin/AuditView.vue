<template>
  <div class="audit-view" data-testid="audit-view">
    <header class="view-header">
      <h2>Audit Log</h2>
      <button type="button" class="refresh" @click="reload" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Entries
        <span class="meta">
          Page {{ page }} / {{ totalPages }}
          <span v-if="rows.length"> &middot; {{ rows.length }} on this page</span>
        </span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading audit log...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No audit entries.</p>
      <table v-else class="audit-table" data-testid="audit-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Target</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in rows"
            :key="row.id ?? `${row.timestamp}-${idx}`"
            :data-testid="`audit-row-${idx}`"
          >
            <td class="muted-cell">{{ formatDate(row.timestamp ?? row.created_at ?? row.createdAt) }}</td>
            <td>{{ row.user ?? row.username ?? '-' }}</td>
            <td>{{ row.action ?? row.event ?? '-' }}</td>
            <td>{{ row.target ?? row.resource ?? '-' }}</td>
            <td class="detail-cell">{{ row.detail ?? row.message ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <nav class="pager" data-testid="audit-pager">
      <button
        type="button"
        class="link"
        :disabled="page <= 1 || loading"
        @click="prev"
        data-testid="audit-prev"
      >
        &laquo; Prev
      </button>
      <span class="pager-info">Page {{ page }} of {{ totalPages }}</span>
      <button
        type="button"
        class="link"
        :disabled="page >= totalPages || loading"
        @click="next"
        data-testid="audit-next"
      >
        Next &raquo;
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import * as adminApi from '../../api/admin.js';

const PAGE_SIZE = 50;

const rows = ref([]);
const loading = ref(false);
const error = ref('');
const page = ref(1);
const total = ref(0);

const totalPages = computed(() => {
  if (!total.value) return 1;
  return Math.max(1, Math.ceil(total.value / PAGE_SIZE));
});

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return String(value);
  }
}

function normalizeRows(data) {
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.entries)) return data.entries;
  if (Array.isArray(data)) return data;
  return [];
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.audit.list();
    const all = normalizeRows(data);
    total.value = Number(data?.total ?? all.length);
    const start = (page.value - 1) * PAGE_SIZE;
    rows.value = all.slice(start, start + PAGE_SIZE);
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load audit log';
    }
  } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  load();
}

function prev() {
  if (page.value > 1) {
    page.value -= 1;
    load();
  }
}

function next() {
  if (page.value < totalPages.value) {
    page.value += 1;
    load();
  }
}

onMounted(load);
</script>

<style scoped>
.audit-view { padding: 8px; }
.audit-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.meta { font-size: 11px; color: var(--muted); text-transform: none; letter-spacing: 0; }
.audit-table { width: 100%; border-collapse: collapse; }
.audit-table th, .audit-table td {
  text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.audit-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.muted-cell { color: var(--muted); font-family: monospace; font-size: 12px; width: 170px; }
.detail-cell { color: var(--text); font-size: 12px; word-break: break-word; }
.pager { display: flex; align-items: center; gap: 12px; padding: 8px 16px; }
.pager-info { color: var(--muted); font-size: 12px; }
.link {
  background: transparent; border: 1px solid var(--border); color: var(--accent);
  padding: 4px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;
}
.link:hover:not(:disabled) { border-color: var(--accent); }
.link:disabled { opacity: 0.5; cursor: not-allowed; }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
</style>