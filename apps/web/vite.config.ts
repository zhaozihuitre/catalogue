import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiTarget = process.env.CATALOGUE_API ?? 'http://127.0.0.1:8443';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false, secure: false } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
