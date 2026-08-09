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
      { path: 'client-access', component: () => import('./views/ClientAccessView.vue') }
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
