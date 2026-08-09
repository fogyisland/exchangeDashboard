<template>
  <div class="registry-view" data-testid="registry-view">
    <header class="view-header">
      <h2>Package Registry</h2>
    </header>

    <section class="panel placeholder-panel">
      <p class="placeholder-title">Packages system not yet wired</p>
      <p class="placeholder-body">
        Package registry configuration (endpoints, credentials, sync schedule) will live here.
        Real implementation deferred until the package system ships.
      </p>
    </section>
  </div>
</template>

<script setup>
// Stub view. Real implementation deferred until the package system is wired.
</script>

<style scoped>
.registry-view { padding: 8px; }
.registry-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; background: var(--panel); padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 6px;
}
.placeholder-panel { padding: 32px; text-align: center; }
.placeholder-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.placeholder-body { color: var(--muted); font-size: 13px; max-width: 540px; margin: 0 auto; line-height: 1.5; }
</style>