import api from './client.js';

export const users = {
  list: () => api.get('/api/admin/users').then((r) => r.data),
  create: (body) => api.post('/api/admin/users', body).then((r) => r.data),
  update: (id, body) => api.patch(`/api/admin/users/${id}`, body).then((r) => r.data),
  remove: (id) => api.delete(`/api/admin/users/${id}`).then((r) => r.data)
};

export const roles = {
  list: () => Promise.resolve({ roles: [] })
};

export const config = {
  getAll: () => api.get('/api/admin/config').then((r) => r.data),
  set: (key, value) => api.put(`/api/admin/config/${key}`, { value }).then((r) => r.data)
};

export const audit = {
  list: () => api.get('/api/admin/audit').then((r) => r.data)
};

export const servers = {
  list: () => api.get('/api/admin/servers').then((r) => r.data),
  get: (id) => api.get(`/api/admin/servers/${id}`).then((r) => r.data),
  upsert: (body) => api.post('/api/admin/servers', body).then((r) => r.data),
  remove: (id) => api.delete(`/api/admin/servers/${id}`).then((r) => r.data)
};

export const dags = {
  list: () => api.get('/api/admin/dags').then((r) => r.data),
  get: (id) => api.get(`/api/admin/dags/${id}`).then((r) => r.data),
  upsert: (body) => api.post('/api/admin/dags', body).then((r) => r.data),
  remove: (id) => api.delete(`/api/admin/dags/${id}`).then((r) => r.data)
};

export const dbs = {
  list: () => api.get('/api/admin/dbs').then((r) => r.data),
  get: (id) => api.get(`/api/admin/dbs/${id}`).then((r) => r.data),
  upsert: (body) => api.post('/api/admin/dbs', body).then((r) => r.data),
  remove: (id) => api.delete(`/api/admin/dbs/${id}`).then((r) => r.data)
};

export const dagReplication = {
  list: () => api.get('/api/admin/dag-replication').then((r) => r.data),
  upsert: (body) => api.post('/api/admin/dag-replication', body).then((r) => r.data),
  remove: (id) => api.delete(`/api/admin/dag-replication/${id}`).then((r) => r.data)
};

export const ports = {
  probe: () => api.get('/api/admin/ports/probe').then((r) => r.data)
};

export const heartbeatReport = {
  list: () => api.get('/api/admin/heartbeat-report').then((r) => r.data),
  stale: ({ seconds } = {}) =>
    api.get('/api/admin/heartbeat-report', { params: { seconds } }).then((r) => r.data)
};
