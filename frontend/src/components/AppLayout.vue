<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="brand">Exchange Dashboard</div>
      <nav>
        <router-link to="/" exact-active-class="active">Overview</router-link>
        <router-link to="/mailflow" active-class="active">Mail Flow</router-link>
        <router-link to="/dag" active-class="active">DAG</router-link>
        <router-link to="/client-access" active-class="active">Client Access</router-link>
        <router-link to="/servers-overview" active-class="active">Servers</router-link>
        <router-link to="/dashboard/metrics" active-class="active">Metrics</router-link>
        <router-link to="/lockout-troubleshooting" active-class="active">Lockout</router-link>
      </nav>
    </aside>
    <div class="main-col">
      <header class="topbar">
        <StatusBar />
        <div class="user-area">
          <span class="username">{{ auth.user?.username }}</span>
          <router-link v-if="auth.isAdmin" to="/admin" class="admin-link">管理</router-link>
          <button type="button" class="logout" @click="onLogout">退出</button>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import StatusBar from './StatusBar.vue';

const router = useRouter();
const auth = useAuthStore();

async function onLogout() {
  await auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.app-layout { display: flex; height: 100vh; }
.sidebar { width: 220px; background: var(--panel); border-right: 1px solid var(--border); padding: 16px 0; }
.brand { color: var(--accent); font-weight: 600; padding: 0 16px 16px; font-size: 15px; }
.sidebar nav { display: flex; flex-direction: column; }
.sidebar nav a { padding: 8px 16px; color: var(--text); font-size: 14px; }
.sidebar nav a:hover { background: var(--panel-alt); }
.sidebar nav a.active { background: var(--panel-alt); color: var(--accent); border-left: 3px solid var(--accent); }
.main-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar { display: flex; align-items: center; justify-content: space-between; background: var(--panel); border-bottom: 1px solid var(--border); padding: 0 16px; height: 48px; }
.user-area { display: flex; align-items: center; gap: 12px; }
.username { color: var(--muted); font-size: 13px; }
.admin-link { color: var(--accent); font-size: 13px; }
.logout { background: transparent; color: var(--muted); border: 1px solid var(--border); padding: 4px 10px; font-size: 13px; }
.logout:hover { color: var(--text); border-color: var(--accent); }
.content { flex: 1; overflow: auto; padding: 16px; }
</style>
