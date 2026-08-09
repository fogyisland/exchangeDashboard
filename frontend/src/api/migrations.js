import api from './client.js';

export const list = () => api.get('/api/migrations').then((r) => r.data);

export const apply = () => api.post('/api/migrations/apply').then((r) => r.data);
