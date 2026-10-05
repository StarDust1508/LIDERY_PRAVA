import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Публичная сборка. Общий код (типы API, клиент, форматирование дат) лежит в
// platform/shared и подключается алиасом: отдельной публикации пакета нет,
// обе сборки собираются из одного репозитория.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // В разработке запросы к API идут на локальный сервер платформы.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  // Просмотр собранной сборки: тот же прокси, что и в разработке, — проверка
  // собранного бандла без запуска nginx.
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  // Публичные файлы (PDF Положения и Приложений, юридические документы) лежат в
  // platform/public и попадают в сборку как статика: адрес /docs/… должен
  // работать и в разработке, и на проде.
  publicDir: path.resolve(__dirname, '../public'),
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
