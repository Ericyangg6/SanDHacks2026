import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // src imports types and to12h from apps/api and data/, outside this package.
  server: { port: 5173, fs: { allow: ['../..'] } },
  // Two pages, no router: the ops dashboard and the resident directions page.
  build: { rollupOptions: { input: { index: 'index.html', directions: 'directions.html' } } },
});
