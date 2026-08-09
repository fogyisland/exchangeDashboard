<template>
  <div class="admin-overview" data-testid="admin-overview-view">
    <header class="view-header">
      <h2>Admin Overview</h2>
    </header>

    <section class="panel">
      <header class="panel-header">Quick links</header>
      <ul class="quick-links">
        <li><router-link to="/admin/users">Users</router-link></li>
        <li><router-link to="/admin/roles">Roles</router-link></li>
        <li><router-link to="/admin/config">System Config</router-link></li>
        <li><router-link to="/admin/audit">Audit Log</router-link></li>
        <li><router-link to="/admin/dags-catalog">DAG Catalog</router-link></li>
        <li><router-link to="/admin/dbs-catalog">Database Catalog</router-link></li>
        <li><router-link to="/admin/dag-replication">DAG Replication Matrix</router-link></li>
        <li><router-link to="/admin/migrations">Schema Migrations</router-link></li>
        <li><router-link to="/admin/ports">Port Probes</router-link></li>
        <li><router-link to="/admin/heartbeat-report">Heartbeat Report Monitor</router-link></li>
        <li><router-link to="/admin/packages">Packages</router-link></li>
        <li><router-link to="/admin/packages/registry">Package Registry</router-link></li>
      </ul>
    </section>
  </div>
</template>

<script setup>
// Static admin landing page — links to all admin sub-views.
</script>

<style scoped>
.admin-overview { padding: 8px; }
.admin-overview h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; background: var(--panel); padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 6px;
}
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; }
.panel-header {
  padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--muted);
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
}
.quick-links {
  list-style: none; margin: 0; padding: 12px 16px; display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px;
}
.quick-links a { color: var(--accent); font-size: 13px; text-decoration: none; }
.quick-links a:hover { text-decoration: underline; }
</style>