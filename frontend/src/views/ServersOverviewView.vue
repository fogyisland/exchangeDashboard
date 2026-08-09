<template>
  <div class="servers-overview">
    <header class="view-header">
      <h2>Servers</h2>
      <div class="actions">
        <button type="button" class="refresh" @click="loadAll" :disabled="loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="loading && servers.length === 0" class="muted">Loading servers...</p>
    <p v-else-if="!loading && servers.length === 0" class="muted">No servers registered.</p>

    <section v-else class="grid" data-testid="servers-grid">
      <ServerCard
        v-for="server in servers"
        :key="server.id"
        :server="server"
        :services="healthFor(server.id).services"
        :resources="healthFor(server.id).resources"
      />
    </section>

    <p v-if="error" class="err">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue';
import * as serversApi from '../api/servers.js';
import ServerCard from '../components/ServerCard.vue';

const servers = ref([]);
const loading = ref(true);
const error = ref('');

// Per-server health cache keyed by server id.
// Shape from /api/servers/:id/health: { services: [...], resources: {...}|null }
// `resources` is null when the agent has not yet reported any perfmon sample.
const healthById = reactive({});

function healthFor(id) {
  return healthById[id] || { services: [], resources: null };
}

async function loadServers() {
  try {
    const data = await serversApi.list();
    // list() unwraps r.data which is the raw object — try { servers: [] } first,
    // fall back to plain array.
    servers.value = data?.servers || data || [];
  } catch (e) {
    servers.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load servers';
    }
  }
}

async function loadHealthFor(server) {
  try {
    // health() returns the unwrapped r.data — { services, resources } directly.
    const data = await serversApi.health(server.id);
    healthById[server.id] = {
      services: Array.isArray(data?.services) ? data.services : [],
      resources: data?.resources ?? null
    };
  } catch (e) {
    // Surface failure for this server only — a missing /health endpoint must
    // not blank the whole overview.
    healthById[server.id] = { services: [], resources: null, error: e.message || 'health failed' };
  }
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    await loadServers();
    await Promise.all(servers.value.map(loadHealthFor));
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.servers-overview { padding: 8px; }
.servers-overview h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.refresh { padding: 6px 12px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
}
.muted { color: var(--muted); }
.err { color: var(--red, #ef4444); margin-top: 12px; }
</style>