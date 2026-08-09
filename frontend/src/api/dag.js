import api from './client.js';

export const list = () => api.get('/api/dag/list').then((r) => r.data);

export const topology = (dagId) =>
  api.get(`/api/dag/${dagId}/topology`).then((r) => r.data);

export const databases = (dagId) =>
  api.get(`/api/dag/${dagId}/databases`).then((r) => r.data);

export const copyStatus = (dagId, dbId) =>
  api.get(`/api/dag/${dagId}/databases/${dbId}/copy-status`).then((r) => r.data);
