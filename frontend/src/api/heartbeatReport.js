import api from './client.js';

export const list = () => api.get('/api/heartbeat-report').then((r) => r.data);

export const stale = ({ seconds } = {}) =>
  api.get('/api/heartbeat-report', { params: { seconds } }).then((r) => r.data);
