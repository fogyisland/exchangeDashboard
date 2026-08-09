import api from './client.js';

export const initApi = {
  getStatus: () => api.get('/api/init/status'),
  testDb: (params) => api.post('/api/init/test-db', params),
  finalize: (params) => api.post('/api/init/finalize', params)
};