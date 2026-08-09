<template>
  <div class="lockout">
    <h2>Lockout Troubleshooting</h2>
    <form class="form" @submit.prevent="onSubmit">
      <label>
        Username
        <input v-model="username" required placeholder="e.g. jdoe" />
      </label>
      <label>
        Source IP
        <input v-model="sourceIp" placeholder="e.g. 10.0.0.5" />
      </label>
      <button type="submit" :disabled="loading">{{ loading ? 'Diagnosing...' : 'Diagnose' }}</button>
    </form>
    <div v-if="error" class="err">Error: {{ error }}</div>
    <div v-if="result" class="result">
      <h3>Result</h3>
      <pre>{{ result }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { diagnose } from '../api/lockout.js';

const username = ref('');
const sourceIp = ref('');
const loading = ref(false);
const error = ref('');
const result = ref(null);

async function onSubmit() {
  error.value = '';
  result.value = null;
  loading.value = true;
  try {
    result.value = await diagnose({ username: username.value, sourceIp: sourceIp.value });
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.lockout h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.form { display: flex; flex-direction: column; gap: 12px; max-width: 400px; }
.form label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 13px; }
.form button { align-self: flex-start; }
.result { margin-top: 24px; background: var(--panel); padding: 16px; border-radius: 6px; }
.result h3 { margin: 0 0 8px; color: var(--accent); font-size: 14px; }
.result pre { white-space: pre-wrap; color: var(--text); margin: 0; font-size: 13px; }
.err { color: var(--red); margin-top: 12px; }
</style>
