import api from './client.js';

export const summary = () => api.get('/api/client-access/summary').then((r) => r.data);

export const perServer = () => api.get('/api/client-access/per-server').then((r) => r.data);

export const latency = () => api.get('/api/client-access/latency').then((r) => r.data);
