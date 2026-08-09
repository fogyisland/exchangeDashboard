import api from './client.js';

// Placeholder: the package registry endpoint is wired in a later task. The
// store still calls this function so it gets a stable shape (an object with
// a `packages` array) and any future swap is just a one-line change here.
export const packagesApi = {
  installed: async () => {
    try {
      const r = await api.get('/api/admin/packages');
      return r.data;
    } catch {
      // Endpoint not yet implemented; return empty registry so the UI degrades gracefully.
      return { packages: [] };
    }
  }
};