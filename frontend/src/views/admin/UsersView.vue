<template>
  <div class="users-view" data-testid="users-view">
    <header class="view-header">
      <h2>Users</h2>
      <button type="button" class="refresh" @click="load" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="err" data-testid="users-error">Error: {{ error }}</p>

    <section class="panel">
      <header class="panel-header">Create user</header>
      <form class="user-form" data-testid="create-form" @submit.prevent="onCreate">
        <label>
          Username
          <input
            v-model.trim="formUsername"
            type="text"
            autocomplete="off"
            required
            data-testid="create-username"
          />
        </label>
        <label>
          Password
          <input
            v-model="formPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            data-testid="create-password"
          />
        </label>
        <label class="role-field">
          Role
          <select v-model="formRole" data-testid="create-role">
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          type="submit"
          class="primary"
          :disabled="creating || !isFormValid"
          data-testid="create-submit"
        >
          {{ creating ? 'Creating...' : 'Create' }}
        </button>
        <p v-if="formError" class="err">{{ formError }}</p>
      </form>
    </section>

    <section class="panel">
      <header class="panel-header">
        Existing users
        <span class="meta" v-if="users.length">{{ users.length }} total</span>
      </header>
      <p v-if="loading && users.length === 0" class="muted">Loading users...</p>
      <p v-else-if="!loading && users.length === 0" class="muted">No users yet.</p>
      <table v-else class="users-table" data-testid="users-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id ?? u.username" :data-testid="`user-row-${u.username}`">
            <td>{{ u.username }}</td>
            <td>{{ u.role || 'viewer' }}</td>
            <td>
              <span :class="['status-pill', u.disabled ? 'off' : 'on']">
                {{ u.disabled ? 'disabled' : 'active' }}
              </span>
            </td>
            <td>{{ formatDate(u.created_at ?? u.createdAt) }}</td>
            <td class="actions-col">
              <button
                type="button"
                class="link"
                @click="toggleEnabled(u)"
                :data-testid="`toggle-${u.username}`"
              >
                {{ u.disabled ? 'Enable' : 'Disable' }}
              </button>
              <button
                type="button"
                class="link danger"
                @click="onDelete(u)"
                :data-testid="`delete-${u.username}`"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import * as adminApi from '../../api/admin.js';

const users = ref([]);
const loading = ref(false);
const error = ref('');

const formUsername = ref('');
const formPassword = ref('');
const formRole = ref('viewer');
const formError = ref('');
const creating = ref(false);

const isFormValid = computed(() => {
  if (!formUsername.value) return false;
  if (!formPassword.value || formPassword.value.length < 8) return false;
  return true;
});

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return String(value);
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.users.list();
    users.value = data?.users || data || [];
  } catch (e) {
    users.value = [];
    if (e?.response?.status !== 401) {
      error.value = e.response?.data?.error?.message || e.message || 'Failed to load users';
    }
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  if (!isFormValid.value) {
    formError.value = 'Username and password (>=8 chars) are required.';
    return;
  }
  formError.value = '';
  creating.value = true;
  try {
    await adminApi.users.create({
      username: formUsername.value,
      password: formPassword.value,
      role: formRole.value
    });
    formUsername.value = '';
    formPassword.value = '';
    formRole.value = 'viewer';
    await load();
  } catch (e) {
    formError.value = e.response?.data?.error?.message || e.message || 'Failed to create user';
  } finally {
    creating.value = false;
  }
}

async function toggleEnabled(u) {
  const username = u.username;
  if (!u.id && u.id !== 0) {
    error.value = `Cannot toggle ${username}: missing user id.`;
    return;
  }
  try {
    await adminApi.users.update(u.id, { disabled: !u.disabled });
    await load();
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to update user';
  }
}

async function onDelete(u) {
  const username = u.username;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const ok = window.confirm(`Delete user "${username}"?`);
    if (!ok) return;
  }
  if (u.id === undefined || u.id === null) {
    error.value = `Cannot delete ${username}: missing user id.`;
    return;
  }
  try {
    await adminApi.users.remove(u.id);
    await load();
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed to delete user';
  }
}

onMounted(load);
</script>

<style scoped>
.users-view { padding: 8px; }
.users-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
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
.user-form {
  display: grid; grid-template-columns: 1fr 1fr 140px auto; gap: 12px; padding: 16px;
  align-items: end;
}
.user-form label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
.user-form input, .user-form select {
  background: var(--panel-alt); color: var(--text); border: 1px solid var(--border);
  padding: 6px 10px; font-size: 13px; border-radius: 4px;
}
.primary {
  background: var(--accent); color: var(--panel); border: none;
  padding: 8px 16px; border-radius: 4px; font-weight: 600; cursor: pointer;
}
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.refresh { padding: 6px 12px; }
.users-table { width: 100%; border-collapse: collapse; }
.users-table th, .users-table td {
  text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
}
.users-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.actions-col { display: flex; gap: 8px; }
.link {
  background: transparent; border: 1px solid var(--border); color: var(--accent);
  padding: 2px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: 6px;
}
.link:hover { border-color: var(--accent); }
.link.danger { color: var(--red, #ef4444); border-color: var(--red, #ef4444); }
.status-pill {
  padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.status-pill.on { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill.off { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.muted { color: var(--muted); padding: 16px; }
.err { color: var(--red, #ef4444); padding: 8px 16px; margin: 0; }
</style>