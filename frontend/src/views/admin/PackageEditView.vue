<template>
  <div class="package-edit-view" data-testid="package-edit-view">
    <header class="view-header">
      <h2>Edit Package: {{ name || '(unknown)' }}</h2>
    </header>

    <section class="panel placeholder-panel">
      <p class="placeholder-title">Packages system not yet wired</p>
      <p class="placeholder-body">
        Editing individual package metadata will be enabled once the package system ships.
        For now this route is a placeholder so navigation works end-to-end.
      </p>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const name = computed(() => String(route.params?.name || ''));
</script>

<style scoped>
.package-edit-view { padding: 8px; }
.package-edit-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; background: var(--panel); padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 6px;
}
.placeholder-panel { padding: 32px; text-align: center; }
.placeholder-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.placeholder-body { color: var(--muted); font-size: 13px; max-width: 540px; margin: 0 auto; line-height: 1.5; }
</style>