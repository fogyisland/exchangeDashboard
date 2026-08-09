<template>
  <div class="roles-view" data-testid="roles-view">
    <header class="view-header">
      <h2>Roles</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        Available roles
        <span class="meta" v-if="roles.length">{{ roles.length }} roles</span>
      </header>
      <p v-if="loading && roles.length === 0" class="muted">Loading roles...</p>
      <table v-else class="roles-table" data-testid="roles-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Description</th>
            <th>Seeded</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in roles"
            :key="r.name"
            :data-testid="`role-row-${r.name}`"
          >
            <td class="role-name">{{ r.name }}</td>
            <td>{{ r.description }}</td>
            <td>
              <span :class="['status-pill', r.seeded ? 'on' : 'off']">
                {{ r.seeded ? 'yes' : 'no' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="muted small">
      Roles are seeded by the migration system and cannot be edited from the UI.
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as adminApi from '../../api/admin.js';

// Static fallback list — used when the API does not return roles.
const SEEDED_ROLES = [
  {
    name: 'admin',
    description: 'Full access — manage users, config, audit, servers, DAGs and DBs.',
    seeded: true
  },
  {
    name: 'operator',
    description: 'Read/write business data and trigger operational actions.',
    seeded: true
  },
  {
    name: 'viewer',
    description: 'Read-only access to dashboards and reports.',
    seeded: true
  }
];

const roles = ref([]);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.roles.list();
    const fromApi = data?.roles || data || [];
    if (Array.isArray(fromApi) && fromApi.length > 0) {
      roles.value = fromApi.map((r) => ({
        name: r.name || r.role,
        description: r.description || '',
        seeded: r.seeded !== false
      }));
    } else {
      roles.value = SEEDED_ROLES.slice();
    }
  } catch (e) {
    roles.value = SEEDED_ROLES.slice();
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load roles';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.roles-view { padding: 8px; }
.roles-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.roles-table { width: 100%; border-collapse: collapse; }
.roles-table th, .roles-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.roles-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.role-name { font-weight: 600; color: var(--accent); }
.status-pill {
  padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.status-pill.on { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill.off { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.muted { color: var(--muted); }
.small { font-size: 12px; padding: 8px 16px; }
.err { color: var(--red, #ef4444); }
</style>