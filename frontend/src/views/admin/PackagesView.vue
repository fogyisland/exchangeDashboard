<template>
  <div class="packages-view" data-testid="packages-view">
    <header class="view-header">
      <h2>Packages</h2>
    </header>

    <el-tabs v-model="activeTab" class="packages-tabs" data-testid="packages-tabs">
      <el-tab-pane label="Installed" name="installed">
        <PackageUpload :uploading="uploading" :error="error" @file-selected="onUpload" />

        <section v-if="packages.length === 0" class="panel empty-panel" data-testid="packages-empty">
          <p class="empty-title">No packages installed</p>
          <p class="empty-body">Upload a package ZIP to extend monitored surfaces, or switch to the Catalog tab to install a built-in package.</p>
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
      </el-tab-pane>

      <el-tab-pane label="Catalog" name="catalog">
        <div v-loading="loading">
          <p v-if="catalog" class="catalog-summary">
            Source: <el-tag>{{ catalog.source }}</el-tag>
            ({{ catalog.packages.length }} packages)
          </p>

          <el-table v-if="catalog" :data="catalog.packages" stripe>
            <el-table-column prop="name" label="Name" width="220" />
            <el-table-column prop="version" label="Version" width="100" />
            <el-table-column prop="title" label="Title" />
            <el-table-column prop="summary" label="Summary" />
            <el-table-column label="Role flags" width="100">
              <template #default="{ row }">{{ describeRoleFlags(row.roleFlags) }}</template>
            </el-table-column>
            <el-table-column label="Install" width="220">
              <template #default="{ row }">
                <el-button size="small" :disabled="installing" @click="openInstallDialog(row)">Install on servers…</el-button>
              </template>
            </el-table-column>
          </el-table>

          <h3 style="margin-top: 24px">Per-server install state</h3>
          <el-table :data="installs" stripe>
            <el-table-column prop="serverId" label="Server" width="100" />
            <el-table-column prop="name" label="Package" width="200" />
            <el-table-column prop="version" label="Version" width="100" />
            <el-table-column label="Status" width="120">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status, row.updatedAt)">{{ statusLabel(row.status, row.updatedAt) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="error" label="Error" />
          </el-table>
        </div>

        <el-dialog v-model="installDialogVisible" title="Install on servers" width="500px">
          <p>Select servers to install <strong>{{ installTarget?.name }}</strong> ({{ installTarget?.version }}):</p>
          <el-checkbox-group v-model="installSelected">
            <el-checkbox v-for="s in servers" :key="s.id" :label="s.id">{{ s.hostname }}</el-checkbox>
          </el-checkbox-group>
          <template #footer>
            <el-button @click="installDialogVisible = false">Cancel</el-button>
            <el-button type="primary" :loading="installing" @click="confirmInstall">Install</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { packagesApi } from '../../api/packages.js';
import api from '../../api/client.js';
import PackageUpload from '../../components/PackageUpload.vue';

// --- Installed tab state (preserved from the original view) ---
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

// --- Tabs ---
const activeTab = ref('installed');

// --- Catalog tab state ---
const catalog = ref(null);
const installs = ref([]);
const servers = ref([]);
const loading = ref(false);
const installing = ref(false);
const installDialogVisible = ref(false);
const installTarget = ref(null);
const installSelected = ref([]);

function describeRoleFlags(f) {
  const flags = Number(f) || 0;
  const bits = [];
  if (flags & 1) bits.push('MBX');
  if (flags & 2) bits.push('HUB');
  if (flags & 4) bits.push('CAS');
  return bits.join('+') || '—';
}

function isStalled(status, updated) {
  if (status !== 'pending' || !updated) return false;
  const t = new Date(updated).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > 24 * 3600 * 1000;
}

function statusType(s, updated) {
  if (s === 'installed') return 'success';
  if (s === 'failed') return 'danger';
  if (isStalled(s, updated)) return 'warning';
  return 'info';
}

function statusLabel(s, updated) {
  if (isStalled(s, updated)) return 'stalled';
  return s;
}

async function loadCatalog() {
  loading.value = true;
  try {
    const [c, i, s] = await Promise.all([
      api.get('/api/admin/catalog/'),
      api.get('/api/admin/catalog/installs'),
      api.get('/api/servers')
    ]);
    catalog.value = c.data;
    installs.value = (i.data && i.data.installs) || [];
    servers.value = (s.data && (s.data.servers || s.data)) || [];
  } catch (e) {
    error.value = e?.response?.data?.error?.message || e.message;
  } finally {
    loading.value = false;
  }
}

function openInstallDialog(pkg) {
  installTarget.value = pkg;
  installSelected.value = [];
  installDialogVisible.value = true;
}

async function confirmInstall() {
  if (!installTarget.value || installSelected.value.length === 0) return;
  installing.value = true;
  try {
    const res = await api.post(`/api/admin/catalog/${encodeURIComponent(installTarget.value.name)}/install`, { serverIds: installSelected.value });
    if (res.status === 207) {
      const failed = (res.data && res.data.failed) || [];
      alert(`Assigned ${res.data?.assigned ?? 0} servers; ${failed.length} failed.`);
    }
    installDialogVisible.value = false;
    await loadCatalog();
  } catch (e) {
    alert(`Install failed: ${e?.response?.data?.error?.message || e.message}`);
  } finally {
    installing.value = false;
  }
}

onMounted(() => {
  refresh();
  loadCatalog();
});
</script>

<style scoped>
.packages-view { padding: 8px; }
.packages-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; background: var(--panel); padding: 12px 16px; border: 1px solid var(--border); border-radius: 6px; gap: 16px; flex-wrap: wrap; }
.packages-tabs { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; }
.empty-panel { padding: 32px; text-align: center; }
.empty-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.empty-body { color: var(--muted); font-size: 13px; }
.packages-list table { width: 100%; border-collapse: collapse; }
.packages-list th, .packages-list td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border); }
.packages-list th { color: var(--muted); font-weight: 600; font-size: 12px; }
.catalog-summary { color: var(--muted); margin: 0 0 12px; }
</style>
