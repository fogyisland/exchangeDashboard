<template>
  <div class="packages-view" data-testid="packages-view">
    <header class="view-header">
      <h2>Packages</h2>
    </header>

    <section class="panel placeholder-panel">
      <p class="placeholder-title">Packages system not yet wired</p>
      <p class="placeholder-body">
        The package / plugin system is scheduled for a later task. This view will list
        installed packages, allow upload / removal, and surface registry connections.
      </p>
    </section>
  </div>
</template>

<script setup>
// Stub view. Real implementation deferred until the package system is wired.
</script>

<style scoped>
.packages-view { padding: 8px; }
.packages-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; background: var(--panel); padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 6px;
}
.placeholder-panel { padding: 32px; text-align: center; }
.placeholder-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.placeholder-body { color: var(--muted); font-size: 13px; max-width: 540px; margin: 0 auto; line-height: 1.5; }
</style>