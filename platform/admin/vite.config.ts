import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Отдельная сборка админ-панели: свои права, свой бандл, закрыта от индексации
// (ТЗ 03, «Почему две сборки, а не одна»). Общий код — в platform/shared.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  preview: {
    port: 4174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
