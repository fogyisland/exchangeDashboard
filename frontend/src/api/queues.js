import api from './client.js';

export const current = ({ serverId } = {}) =>
  api.get('/api/queues/current', { params: { serverId } }).then((r) => r.data);

export const history = ({ serverId, queueKind, from, to }) =>
  api
    .get('/api/queues/history', { params: { serverId, queueKind, from, to } })
    .then((r) => r.data);

export const byServer = (serverId) =>
  api.get(`/api/queues/by-server/${serverId}`).then((r) => r.data);

export const stuck = () => api.get('/api/queues/stuck').then((r) => r.data);
