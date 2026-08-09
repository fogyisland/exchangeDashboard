<template>
  <div class="dashboard">
    <h2>Overview</h2>
    <p v-if="loading" class="muted">Loading...</p>
    <p v-else-if="error" class="err">Error: {{ error }}</p>
    <div v-else-if="data" class="cards">
      <div class="card">
        <div class="card-label">Servers</div>
        <div class="card-value">{{ data.serverCount }}</div>
      </div>
      <div class="card">
        <div class="card-label">DAGs</div>
        <div class="card-value">{{ data.dagCount }}</div>
      </div>
      <div class="card">
        <div class="card-label">Mailbox Databases</div>
        <div class="card-value">{{ data.mdbCount }}</div>
      </div>
      <div class="card">
        <div class="card-label">Queue Messages (now)</div>
        <div class="card-value">{{ queuesTotal }}</div>
        <div class="card-sub" v-if="data.queuesNow?.length">
          <span v-for="row in data.queuesNow" :key="row.queue_kind" class="chip">
            {{ row.queue_kind }}: {{ row.total }}
          </span>
        </div>
      </div>
      <div class="card" :class="{ alert: data.recentMdbErrors > 0 }">
        <div class="card-label">Recent MDB Errors (1h)</div>
        <div class="card-value">{{ data.recentMdbErrors }}</div>
      </div>
    </div>
    <div v-else class="empty">No data available.</div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { overview } from '../api/dashboard.js';

const data = ref(null);
const loading = ref(true);
const error = ref('');

const queuesTotal = computed(() => {
  const rows = data.value?.queuesNow;
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  return rows.reduce((s, r) => s + Number(r.total || 0), 0);
});

onMounted(async () => {
  try {
    data.value = await overview();
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to load';
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.dashboard { padding: 8px; }
.dashboard h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 16px; }
.card-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.card-value { color: var(--text); font-size: 28px; font-weight: 600; margin-top: 6px; }
.card-sub { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.card-sub .chip { background: var(--panel-alt); color: var(--muted); padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.card.alert { border-color: var(--red); }
.card.alert .card-value { color: var(--red); }
.muted { color: var(--muted); }
.err { color: var(--red); }
.empty { color: var(--muted); padding: 32px; text-align: center; }
</style>
