<template>
  <div class="config-view" data-testid="config-view">
    <header class="view-header">
      <h2>System Config</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Configuration keys
        <span class="meta" v-if="rows.length">{{ rows.length }} keys</span>
      </header>
      <p v-if="loading && rows.length === 0" class="muted">Loading config...</p>
      <p v-else-if="!loading && rows.length === 0" class="muted">No config keys found.</p>
      <table v-else class="config-table" data-testid="config-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Updated</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :data-testid="`config-row-${row.key}`">
            <td class="key-cell">
              <code>{{ row.key }}</code>
            </td>
            <td class="value-cell">
              <input
                v-if="editingKey === row.key"
                v-model="editValue"
                type="text"
                class="edit-input"
                :data-testid="`config-input-${row.key}`"
                @keyup.enter="commitEdit(row)"
                @keyup.esc="cancelEdit"
              />
              <span v-else class="display-value">{{ row.value }}</span>
            </td>
            <td class="muted-cell">{{ formatDate(row.updated_at ?? row.updatedAt) }}</td>
            <td class="actions-col">
              <template v-if="editingKey === row.key">
                <button
                  type="button"
                  class="link primary"
                  :data-testid="`config-save-${row.key}`"
                  @click="commitEdit(row)"
                >
                  Save
                </button>
                <button type="button" class="link" @click="cancelEdit">Cancel</button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="link"
                  :data-testid="`config-edit-${row.key}`"
                  @click="startEdit(row)"
                >
                  Edit
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="successMsg" class="ok">{{ successMsg }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as adminApi from '../../api/admin.js';

const rows = ref([]);
const loading = ref(false);
const error = ref('');
const editingKey = ref('');
const editValue = ref('');
const savingKey = ref('');
const successMsg = ref('');

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return String(value);
  }
}

function normalizeRows(data) {
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.config)) return data.config;
  if (Array.isArray(data)) return data;
  return [];
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.config.getAll();
    rows.value = normalizeRows(data).map((r) => ({
      key: r.key ?? r.name,
      value: r.value ?? '',
      updated_at: r.updated_at ?? r.updatedAt ?? null
    }));
  } catch (e) {
    rows.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load config';
    }
  } finally {
    loading.value = false;
  }
}

function startEdit(row) {
  editingKey.value = row.key;
  editValue.value = row.value;
  successMsg.value = '';
}

function cancelEdit() {
  editingKey.value = '';
  editValue.value = '';
}

async function commitEdit(row) {
  if (savingKey.value) return;
  savingKey.value = row.key;
  error.value = '';
  successMsg.value = '';
  try {
    await adminApi.config.set(row.key, editValue.value);
    const i = rows.value.findIndex((r) => r.key === row.key);
    if (i !== -1) {
      rows.value[i] = {
        ...rows.value[i],
        value: editValue.value,
        updated_at: new Date().toISOString()
      };
    }
    successMsg.value = `Updated ${row.key}.`;
    editingKey.value = '';
    editValue.value = '';
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to update config';
  } finally {
    savingKey.value = '';
  }
}

onMounted(load);
</script>

<style scoped>
.config-view { padding: 8px; }
.config-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.config-table { width: 100%; border-collapse: collapse; }
.config-table th, .config-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
  vertical-align: middle;
}
.config-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.key-cell { width: 220px; }
.key-cell code { color: var(--accent); font-size: 12px; }
.value-cell { min-width: 200px; }
.display-value { color: var(--text); word-break: break-all; }
.edit-input {
  width: 100%; background: var(--panel-alt); color: var(--text);
  border: 1px solid var(--accent); padding: 4px 8px; font-size: 13px; border-radius: 4px;
  font-family: inherit;
}
.muted-cell { color: var(--muted); font-size: 12px; width: 180px; }
.actions-col { width: 160px; }
.link {
  background: transparent; border: 1px solid var(--border); color: var(--accent);
  padding: 2px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: 6px;
}
.link:hover { border-color: var(--accent); }
.link.primary { background: var(--accent); color: var(--panel); border-color: var(--accent); }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
.ok { color: #22c55e; padding: 8px 16px; margin: 0; }
</style>