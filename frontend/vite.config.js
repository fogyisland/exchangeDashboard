import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ECharts (with zrender) is the largest dep; split it out so the
          // initial bundle stays small and the chart code is lazy-loaded
          // alongside the views that use it.
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts';
          // Pinia, vue-router, vue are loaded by every page — vendor chunk.
          if (
            id.includes('node_modules/vue') ||
            id.includes('node_modules/pinia') ||
            id.includes('node_modules/vue-router')
          ) return 'vendor';
        }
      }
    }
  }
});
