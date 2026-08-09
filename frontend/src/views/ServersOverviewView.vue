<template>
  <div class="servers">
    <h2>Servers</h2>
    <p v-if="loading" class="muted">Loading...</p>
    <p v-else-if="error" class="err">Error: {{ error }}</p>
    <table v-else-if="servers.length" class="grid">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Enabled</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in servers" :key="s.id">
          <td>{{ s.id }}</td>
          <td>{{ s.name }}</td>
          <td>{{ s.enabled ? 'Yes' : 'No' }}</td>
          <td>{{ s.created_at || '-' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">No servers registered.</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { list } from '../api/servers.js';

const servers = ref([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const data = await list();
    servers.value = data?.servers || data || [];
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load';
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.servers h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.grid { width: 100%; border-collapse: collapse; background: var(--panel); }
.grid th, .grid td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; font-size: 13px; }
.grid th { color: var(--muted); font-weight: 600; }
.muted { color: var(--muted); }
.err { color: var(--red); }
</style>
