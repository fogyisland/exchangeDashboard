<template>
  <div class="status-bar">
    <span class="dot" :class="statusClass" />
    <span class="label">{{ label }}</span>
    <span v-if="serverCount != null" class="meta"> {{ serverCount }} server(s)</span>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { overview } from '../api/dashboard.js';

const serverCount = ref(null);
const loaded = ref(false);
const errored = ref(false);

onMounted(async () => {
  try {
    const data = await overview();
    serverCount.value = data?.serverCount ?? 0;
    loaded.value = true;
  } catch {
    errored.value = true;
  }
});

const statusClass = computed(() => {
  if (errored.value) return 'err';
  if (loaded.value) return 'ok';
  return 'pending';
});
const label = computed(() => {
  if (errored.value) return 'Offline';
  if (loaded.value) return 'Online';
  return 'Connecting...';
});
</script>

<style scoped>
.status-bar { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.ok { background: var(--green); }
.dot.err { background: var(--red); }
.dot.pending { background: var(--yellow); }
.label { color: var(--text); }
.meta { color: var(--muted); }
</style>
