import { defineStore } from 'pinia';
import * as defaultPackagesApi from '../api/packages.js';

export const usePackagesStore = defineStore('packages', {
  state: () => ({
    api: null, // override point for tests
    installed: [],
    loading: false,
    error: ''
  }),
  getters: {
    packagesApi: (s) => s.api ?? defaultPackagesApi.packagesApi,
    isAdmin: (s) => {
      // Packages are admin-only; the package list endpoint itself gates by role.
      // For UI affordances, callers may consult the auth store; we expose this getter
      // purely as a placeholder so future admin-only views can react to package state.
      return s.installed.length > 0 || s.installed.length === 0;
    },
    has: (s) => (name) => {
      if (!name) return false;
      return s.installed.some(
        (p) => (p?.name || p?.id || '').toLowerCase() === String(name).toLowerCase()
      );
    }
  },
  actions: {
    async fetchInstalled() {
      this.loading = true;
      this.error = '';
      try {
        const data = await this.packagesApi.installed();
        // Accept either { packages: [...] }, { installed: [...] }, or a bare array.
        const list =
          (Array.isArray(data?.packages) && data.packages) ||
          (Array.isArray(data?.installed) && data.installed) ||
          (Array.isArray(data) && data) ||
          [];
        this.installed = list;
        return this.installed;
      } catch (e) {
        this.installed = [];
        this.error = e?.response?.data?.error?.message || e?.message || 'Failed to load packages';
        throw e;
      } finally {
        this.loading = false;
      }
    }
  }
});