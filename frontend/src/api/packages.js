import api from './client.js';

function formHeaders() {
  // Let the browser set the multipart boundary — don't override Content-Type.
  return {};
}

export const packagesApi = {
  list: async () => {
    const r = await api.get('/api/admin/packages');
    return r.data;
  },
  get: async (name) => {
    const r = await api.get(`/api/admin/packages/${encodeURIComponent(name)}`);
    return r.data;
  },
  upload: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await api.post('/api/admin/packages/install', fd, { headers: formHeaders() });
    return r.data;
  },
  uninstall: async (name) => {
    const r = await api.delete(`/api/admin/packages/${encodeURIComponent(name)}?confirmDropSchema=true`);
    return r.data;
  },
  enable: async (name) => {
    const r = await api.post(`/api/admin/packages/${encodeURIComponent(name)}/enable`);
    return r.data;
  },
  disable: async (name) => {
    const r = await api.post(`/api/admin/packages/${encodeURIComponent(name)}/disable`);
    return r.data;
  },
  // Backward-compatible alias for the existing store.
  installed: async () => {
    try { return await packagesApi.list(); } catch { return { packages: [] }; }
  }
};
