import api from './client.js';

export const authApi = {
  login: (body) => api.post('/api/auth/login', body),
  logout: () => api.post('/api/auth/logout'),
  me: () => api.get('/api/auth/me')
};