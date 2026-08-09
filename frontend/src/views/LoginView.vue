<template>
  <div class="login-bg">
    <form class="login-card" @submit.prevent="onSubmit">
      <h2>Exchange Dashboard</h2>
      <label>Username <input v-model="username" autocomplete="username" required /></label>
      <label>Password <input v-model="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit" :disabled="loading">{{ loading ? 'Signing in...' : 'Sign in' }}</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function onSubmit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login({ username: username.value, password: password.value });
    router.push(route.query.redirect || '/');
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Login failed';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-bg { display: flex; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #0b1220, #1e293b); }
.login-card { background: var(--panel); padding: 32px; border-radius: 8px; min-width: 320px; display: flex; flex-direction: column; gap: 14px; }
.login-card h2 { margin: 0 0 8px; font-size: 18px; color: var(--accent); }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
.err { color: var(--red); font-size: 13px; margin: 0; }
</style>