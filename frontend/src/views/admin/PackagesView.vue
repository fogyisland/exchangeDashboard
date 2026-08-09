<template>
  <div class="packages-view" data-testid="packages-view">
    <header class="view-header">
      <h2>Packages</h2>
      <PackageUpload :uploading="uploading" :error="error" @file-selected="onUpload" />
    </header>

    <section v-if="packages.length === 0" class="panel empty-panel" data-testid="packages-empty">
      <p class="empty-title">No packages installed</p>
      <p class="empty-body">Upload a package ZIP to extend monitored surfaces.</p>
    </section>

    <section v-else class="panel packages-list" data-testid="packages-list">
      <table>
        <thead>
          <tr><th>Name</th><th>Version</th><th>Type</th><th>Enabled</th><th>Installed</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="pkg in packages" :key="pkg.name" :data-testid="`package-row-${pkg.name}`">
            <td><router-link :to="`/admin/packages/${pkg.name}`">{{ pkg.name }}</router-link></td>
            <td>{{ pkg.manifest?.version || '—' }}</td>
            <td>{{ pkg.type }}</td>
            <td>{{ pkg.enabled ? 'yes' : 'no' }}</td>
            <td>{{ formatDate(pkg.installedAt) }}</td>
            <td><router-link :to="`/admin/packages/${pkg.name}`">edit</router-link></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { packagesApi } from '../../api/packages.js';
import PackageUpload from '../../components/PackageUpload.vue';

const packages = ref([]);
const uploading = ref(false);
const error = ref('');

function formatDate(d) { try { return new Date(d).toLocaleString(); } catch { return '—'; } }

async function refresh() {
  try { const r = await packagesApi.list(); packages.value = r.packages || []; }
  catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
}

async function onUpload(file) {
  uploading.value = true; error.value = '';
  try { await packagesApi.upload(file); await refresh(); }
  catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
  finally { uploading.value = false; }
}

onMounted(refresh);
</script>

<style scoped>
.packages-view { padding: 8px; }
.packages-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; background: var(--panel); padding: 12px 16px; border: 1px solid var(--border); border-radius: 6px; gap: 16px; flex-wrap: wrap; }
.empty-panel { padding: 32px; text-align: center; }
.empty-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.empty-body { color: var(--muted); font-size: 13px; }
.packages-list table { width: 100%; border-collapse: collapse; }
.packages-list th, .packages-list td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border); }
.packages-list th { color: var(--muted); font-weight: 600; font-size: 12px; }
</style>
