import { createRouter, createWebHistory } from 'vue-router';
import api from './api/client.js';
import LoginView from './views/LoginView.vue';
import InitWizardView from './views/init/InitWizardView.vue';
import NotFoundView from './views/NotFoundView.vue';

const routes = [
  { path: '/init', component: InitWizardView, meta: { public: true } },
  { path: '/login', component: LoginView, meta: { public: true } },
  {
    path: '/',
    component: () => import('./components/AppLayout.vue'),
    children: [
      { path: '', component: () => import('./views/DashboardView.vue') },
      { path: 'mailflow', component: () => import('./views/MailFlowView.vue') },
      { path: 'dag', component: () => import('./views/DagTopologyView.vue') },
      { path: 'dag/grid', component: () => import('./views/DagGridView.vue') },
      { path: 'client-access', component: () => import('./views/ClientAccessView.vue') },
      { path: 'servers-overview', component: () => import('./views/ServersOverviewView.vue') }
    ]
  },
  {
    path: '/admin',
    component: () => import('./components/AdminLayout.vue'),
    meta: { perm: 'admin' },
    children: [
      { path: '', component: () => import('./views/admin/AdminOverviewView.vue') },
      { path: 'users', component: () => import('./views/admin/UsersView.vue') },
      { path: 'roles', component: () => import('./views/admin/RolesView.vue') },
      { path: 'config', component: () => import('./views/admin/ConfigView.vue') },
      { path: 'audit', component: () => import('./views/admin/AuditView.vue') },
      { path: 'dags-catalog', component: () => import('./views/admin/DagsCatalogView.vue') },
      { path: 'dbs-catalog', component: () => import('./views/admin/DbsCatalogView.vue') },
      {
        path: 'dag-replication',
        component: () => import('./views/admin/DagReplicationMatrixView.vue')
      },
      { path: 'migrations', component: () => import('./views/admin/SchemaMigrationsView.vue') },
      { path: 'ports', component: () => import('./views/admin/PortsView.vue') },
      {
        path: 'heartbeat-report',
        component: () => import('./views/admin/HeartbeatReportMonitorView.vue')
      },
      { path: 'packages', component: () => import('./views/admin/PackagesView.vue') },
      {
        path: 'packages/registry',
        component: () => import('./views/admin/RegistryView.vue')
      },
      {
        path: 'packages/:name',
        component: () => import('./views/admin/PackageEditView.vue')
      }
    ]
  },
  { path: '/:pathMatch(.*)*', component: NotFoundView }
];

const router = createRouter({ history: createWebHistory(), routes });

let initStatusCache = null;
async function getInitStatus() {
  if (initStatusCache !== null) return initStatusCache;
  try {
    const r = await api.get('/api/init/status');
    initStatusCache = r.data;
  } catch {
    initStatusCache = { needsInit: false };
  }
  return initStatusCache;
}

router.beforeEach(async (to) => {
  const status = await getInitStatus();
  if (status.needsInit && to.path !== '/init') return { path: '/init' };
  if (!status.needsInit && to.path === '/init') return { path: '/login' };
  if (to.meta.public) return true;
  const t = localStorage.getItem('ed_token');
  if (!t) return { path: '/login', query: { redirect: to.fullPath } };
  return true;
});

export function resetInitStatusCache() {
  initStatusCache = null;
}

export function _resetInitStatusCacheForTest() { initStatusCache = null; }

export default router;