import api from './client.js';

export const diagnose = ({ username, sourceIp }) =>
  api.post('/api/lockout/diagnose', { username, sourceIp }).then((r) => r.data);
