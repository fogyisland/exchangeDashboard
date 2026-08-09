import { defineStore } from 'pinia';
import * as initApi from '../api/init.js';

export const useInitStore = defineStore('init', {
  state: () => ({
    needsInit: null,
    status: null
  }),
  actions: {
    async refresh() {
      const r = await initApi.getStatus();
      this.status = r.data;
      this.needsInit = !!r.data?.needsInit;
      return r.data;
    }
  }
});