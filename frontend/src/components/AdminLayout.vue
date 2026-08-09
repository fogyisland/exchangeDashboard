<template>
  <div class="admin-layout">
    <aside class="sidebar">
      <div class="brand">Admin</div>
      <nav>
        <router-link to="/admin" exact-active-class="active">Overview</router-link>
        <router-link to="/admin/users" active-class="active">Users</router-link>
        <router-link to="/admin/roles" active-class="active">Roles</router-link>
        <router-link to="/admin/config" active-class="active">Config</router-link>
        <router-link to="/admin/audit" active-class="active">Audit</router-link>
        <router-link to="/admin/servers" active-class="active">Servers</router-link>
        <router-link to="/admin/dags-catalog" active-class="active">DAGs</router-link>
        <router-link to="/admin/dbs-catalog" active-class="active">Databases</router-link>
        <router-link to="/admin/dag-replication" active-class="active">DAG Replication</router-link>
        <router-link to="/admin/migrations" active-class="active">Migrations</router-link>
        <router-link to="/admin/ports" active-class="active">Ports</router-link>
        <router-link to="/admin/heartbeat-report" active-class="active">Heartbeat Report</router-link>
        <router-link to="/admin/packages" active-class="active">Packages</router-link>
        <router-link to="/admin/packages/registry" active-class="active">Registry</router-link>
      </nav>
    </aside>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.admin-layout { display: flex; height: 100%; }
.sidebar { width: 200px; background: var(--panel); border-right: 1px solid var(--border); padding: 12px 0; }
.brand { color: var(--accent); font-weight: 600; padding: 0 12px 12px; font-size: 14px; }
.sidebar nav { display: flex; flex-direction: column; }
.sidebar nav a { padding: 6px 12px; color: var(--text); font-size: 13px; }
.sidebar nav a:hover { background: var(--panel-alt); }
.sidebar nav a.active { background: var(--panel-alt); color: var(--accent); border-left: 3px solid var(--accent); }
.content { flex: 1; overflow: auto; padding: 16px; }
</style>