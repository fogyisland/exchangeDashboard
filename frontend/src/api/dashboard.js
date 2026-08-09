import api from './client.js';

export const overview = () => api.get('/api/dashboard/overview').then((r) => r.data);

export const metricsSummary = (packageName) =>
  api.get('/api/dashboard/metrics/summary', { params: { packageName } }).then((r) => r.data);

export const metricsTimeseries = ({ metricId, from, to, agentId }) =>
  api
    .get('/api/dashboard/metrics/timeseries', { params: { metricId, from, to, agentId } })
    .then((r) => r.data);
