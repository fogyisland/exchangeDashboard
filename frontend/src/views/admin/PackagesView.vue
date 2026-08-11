<template>
  <div class="packages-view" data-testid="packages-view">
    <header class="view-header">
      <h2>Packages</h2>
    </header>

    <div class="packages-tabs" data-testid="packages-tabs">
      <div class="tab-nav" role="tablist">
        <button
          type="button"
          class="tab-button"
          :class="{ active: activeTab === 'installed' }"
          role="tab"
          :aria-selected="activeTab === 'installed'"
          data-testid="tab-installed"
          @click="activeTab = 'installed'"
        >Installed</button>
        <button
          type="button"
          class="tab-button"
          :class="{ active: activeTab === 'catalog' }"
          role="tab"
          :aria-selected="activeTab === 'catalog'"
          data-testid="tab-catalog"
          @click="activeTab = 'catalog'"
        >Catalog</button>
      </div>

      <div class="tab-panel" v-show="activeTab === 'installed'" role="tabpanel">
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
      </div>

      <div class="tab-panel" v-show="activeTab === 'catalog'" role="tabpanel">
        <div class="catalog-loading" v-if="loading">Loading catalog…</div>

        <p v-if="catalog" class="catalog-summary">
          Source: <span class="status-pill status-installed">{{ catalog.source }}</span>
          ({{ catalog.packages.length }} packages)
        </p>

        <section v-if="catalog" class="panel packages-list" data-testid="catalog-list">
          <table>
            <thead>
              <tr>
                <th style="width: 220px">Name</th>
                <th style="width: 100px">Version</th>
                <th>Title</th>
                <th>Summary</th>
                <th style="width: 100px">Role flags</th>
                <th style="width: 220px">Install</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in catalog.packages" :key="row.name" :data-testid="`catalog-row-${row.name}`">
                <td>{{ row.name }}</td>
                <td>{{ row.version }}</td>
                <td>{{ row.title }}</td>
                <td>{{ row.summary }}</td>
                <td>{{ describeRoleFlags(row.roleFlags) }}</td>
                <td>
                  <button
                    type="button"
                    class="btn-link"
                    :disabled="installing"
                    @click="openInstallDialog(row)"
                  >Install on servers…</button>
                </td>
              </tr>
              <tr v-if="catalog.packages.length === 0">
                <td colspan="6" class="empty-row">No packages in catalog.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <h3 class="section-heading">Per-server install state</h3>
        <section class="panel packages-list" data-testid="install-state-list">
          <table>
            <thead>
              <tr>
                <th style="width: 100px">Server</th>
                <th style="width: 200px">Package</th>
                <th style="width: 100px">Version</th>
                <th style="width: 120px">Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in installs" :key="`${row.serverId}-${row.name}-${idx}`">
                <td>{{ row.serverId }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.version }}</td>
                <td>
                  <span :class="['status-pill', statusType(row.status, row.updatedAt)]">
                    {{ statusLabel(row.status, row.updatedAt) }}
                  </span>
                </td>
                <td>{{ row.error || '' }}</td>
              </tr>
              <tr v-if="installs.length === 0">
                <td colspan="5" class="empty-row">No install records yet.</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>

    <div v-if="installDialogVisible" class="modal-backdrop" @click.self="installDialogVisible = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title">
        <div class="modal-header">
          <h3 id="install-dialog-title">Install on servers</h3>
          <button type="button" class="modal-close" aria-label="Close" @click="installDialogVisible = false">×</button>
        </div>
        <div class="modal-body">
          <p>Select servers to install <strong>{{ installTarget?.name }}</strong> ({{ installTarget?.version }}):</p>
          <div class="server-checkboxes">
            <label v-for="s in servers" :key="s.id" class="server-checkbox">
              <input
                type="checkbox"
                :value="s.id"
                :checked="installSelected.includes(s.id)"
                @change="toggleServerSelection(s.id, $event.target.checked)"
              />
              <span>{{ s.hostname }}</span>
            </label>
            <p v-if="servers.length === 0" class="empty-row">No servers available.</p>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" @click="installDialogVisible = false">Cancel</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="installing || installSelected.length === 0"
            @click="confirmInstall"
          >{{ installing ? 'Installing…' : 'Install' }}</button>
        </div>
      </div>
    </div>
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
  if (s === 'installed') return 'status-installed';
  if (s === 'failed') return 'status-failed';
  if (isStalled(s, updated)) return 'status-stalled';
  return 'status-pending';
}

function statusLabel(s, updated) {
  if (isStalled(s, updated)) return 'stalled';
  return s;
}

function toggleServerSelection(id, checked) {
  const set = new Set(installSelected.value);
  if (checked) set.add(id); else set.delete(id);
  installSelected.value = Array.from(set);
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

.tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.tab-button { background: transparent; border: none; padding: 8px 16px; cursor: pointer; color: var(--muted); font-size: 14px; font-weight: 500; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab-button:hover { color: var(--accent); }
.tab-button.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-button:focus { outline: 2px solid var(--accent); outline-offset: 2px; }

.tab-panel { padding-top: 8px; }

.empty-panel { padding: 32px; text-align: center; }
.empty-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.empty-body { color: var(--muted); font-size: 13px; }
.empty-row { color: var(--muted); text-align: center; padding: 16px; font-style: italic; }

.packages-list table { width: 100%; border-collapse: collapse; }
.packages-list th, .packages-list td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border); }
.packages-list th { color: var(--muted); font-weight: 600; font-size: 12px; }

.catalog-summary { color: var(--muted); margin: 0 0 12px; }
.catalog-loading { color: var(--muted); padding: 12px 0; font-style: italic; }
.section-heading { margin-top: 24px; margin-bottom: 12px; color: var(--accent); font-size: 15px; font-weight: 600; }

.status-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: capitalize; border: 1px solid transparent; }
.status-installed { background: rgba(46, 160, 67, 0.15); color: #2ea043; border-color: rgba(46, 160, 67, 0.4); }
.status-failed { background: rgba(220, 50, 50, 0.15); color: #d63232; border-color: rgba(220, 50, 50, 0.4); }
.status-pending { background: rgba(56, 139, 232, 0.15); color: #388be8; border-color: rgba(56, 139, 232, 0.4); }
.status-stalled { background: rgba(200, 130, 30, 0.15); color: #c8821e; border-color: rgba(200, 130, 30, 0.4); }

.btn-link { background: transparent; border: none; color: var(--accent); cursor: pointer; padding: 4px 8px; font-size: 13px; text-decoration: underline; }
.btn-link:hover { color: var(--accent-strong, #fff); }
.btn-link:disabled { color: var(--muted); cursor: not-allowed; text-decoration: none; }
.btn-link:focus { outline: 2px solid var(--accent); outline-offset: 2px; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; min-width: 400px; max-width: 600px; width: 500px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.modal-header h3 { margin: 0; color: var(--accent); font-size: 16px; }
.modal-close { background: transparent; border: none; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; padding: 4px 8px; }
.modal-close:hover { color: var(--accent); }
.modal-body { padding: 16px; overflow-y: auto; }
.modal-body p { margin: 0 0 12px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.btn-primary, .btn-secondary { padding: 6px 14px; border-radius: 4px; font-size: 13px; cursor: pointer; border: 1px solid transparent; font-weight: 500; }
.btn-primary { background: var(--accent); color: var(--accent-contrast, #fff); border-color: var(--accent); }
.btn-primary:hover { filter: brightness(1.1); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-secondary { background: transparent; color: var(--muted); border-color: var(--border); }
.btn-secondary:hover { color: var(--accent); border-color: var(--accent); }

.server-checkboxes { display: flex; flex-direction: column; gap: 6px; }
.server-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; }
.server-checkbox input { cursor: pointer; }
</style>
