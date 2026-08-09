<template>
  <div class="package-edit-view" data-testid="package-edit-view">
    <header class="view-header">
      <h2>Edit Package: {{ pkg?.name || name || '(unknown)' }}</h2>
      <div class="header-actions">
        <button v-if="pkg?.enabled" @click="onDisable" data-testid="package-disable-btn">Disable</button>
        <button v-else @click="onEnable" data-testid="package-enable-btn">Enable</button>
      </div>
    </header>

    <section v-if="error" class="panel error-panel">{{ error }}</section>

    <section v-if="pkg" class="panel manifest-panel">
      <h3>Manifest</h3>
      <dl class="manifest-fields">
        <dt>Name</dt><dd>{{ pkg.manifest?.name }}</dd>
        <dt>Version</dt><dd>{{ pkg.manifest?.version }}</dd>
        <dt>Type</dt><dd>{{ pkg.type }}</dd>
        <dt>Description</dt><dd>{{ pkg.manifest?.description || '—' }}</dd>
        <dt>Author</dt><dd>{{ pkg.manifest?.author || '—' }}</dd>
        <dt>Metric table</dt><dd><code>{{ pkg.manifest?.database?.metricTable }}</code></dd>
        <dt>Installed</dt><dd>{{ new Date(pkg.installedAt).toLocaleString() }}</dd>
      </dl>
      <details>
        <summary>Raw manifest</summary>
        <pre>{{ JSON.stringify(pkg.manifest, null, 2) }}</pre>
      </details>
    </section>

    <section v-if="pkg" class="panel uninstall-panel">
      <h3>Uninstall</h3>
      <p class="warn">Dropping the schema deletes all data for this package. This cannot be undone.</p>
      <label class="confirm-row">
        <input type="checkbox" v-model="confirmChecked" data-testid="package-uninstall-confirm" />
        I understand this will drop <code>pkg_{{ (pkg.name || '').replace(/-/g, '_') }}</code>
      </label>
      <button :disabled="!confirmChecked" @click="onUninstall" data-testid="package-uninstall-btn" class="danger">Uninstall</button>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { packagesApi } from '../../api/packages.js';

const route = useRoute();
const router = useRouter();
const name = computed(() => String(route.params?.name || ''));
const pkg = ref(null);
const error = ref('');
const confirmChecked = ref(false);

async function refresh() {
  try { pkg.value = await packagesApi.get(name.value); error.value = ''; }
  catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
}

async function onEnable() { try { await packagesApi.enable(name.value); await refresh(); } catch (e) { error.value = e.message; } }
async function onDisable() { try { await packagesApi.disable(name.value); await refresh(); } catch (e) { error.value = e.message; } }
async function onUninstall() {
  try {
    await packagesApi.uninstall(name.value);
    router.push('/admin/packages');
  } catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
}

onMounted(refresh);
</script>

<style scoped>
.package-edit-view { padding: 8px; }
.package-edit-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; background: var(--panel); padding: 12px 16px; border: 1px solid var(--border); border-radius: 6px; }
.manifest-panel, .uninstall-panel { padding: 16px; margin-bottom: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.manifest-fields { display: grid; grid-template-columns: 160px 1fr; gap: 6px 16px; margin: 0 0 12px; }
.manifest-fields dt { color: var(--muted); font-size: 12px; }
.manifest-fields dd { margin: 0; font-size: 13px; }
.warn { color: var(--danger); font-size: 13px; }
.confirm-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.danger { background: var(--danger); color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
.danger:disabled { opacity: 0.5; cursor: not-allowed; }
.error-panel { padding: 12px; background: var(--danger); color: white; margin-bottom: 12px; border-radius: 4px; }
</style>
