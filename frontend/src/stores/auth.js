import { defineStore } from 'pinia';
import * as defaultAuthApi from '../api/auth.js';

function safeParseUser() {
  try { return JSON.parse(localStorage.getItem('ed_user') || 'null'); }
  catch { return null; }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    api: null, // override point for tests
    token: localStorage.getItem('ed_token'),
    user: safeParseUser()
  }),
  getters: {
    authApi: (s) => s.api ?? defaultAuthApi.authApi,
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin'
  },
  actions: {
    async login({ username, password }) {
      const r = await this.authApi.login({ username, password });
      const data = r.data ?? r; // support both axios responses and stubbed plain objects
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('ed_token', this.token);
      localStorage.setItem('ed_user', JSON.stringify(this.user));
      return data;
    },
    async logout() {
      try { await this.authApi.logout(); } catch { /* ignore */ }
      this.token = null;
      this.user = null;
      localStorage.removeItem('ed_token');
      localStorage.removeItem('ed_user');
    }
  }
});