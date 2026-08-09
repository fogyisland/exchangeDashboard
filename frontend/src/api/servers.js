import api from './client.js';

export const list = () => api.get('/api/servers').then((r) => r.data);

export const get = (id) => api.get(`/api/servers/${id}`).then((r) => r.data);

export const health = (id) => api.get(`/api/servers/${id}/health`).then((r) => r.data);
