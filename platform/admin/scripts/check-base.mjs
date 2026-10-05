#!/usr/bin/env node
// Проверка базового пути сборки админки (ТЗ 03: отдельная сборка на /admin).
//
// Если base не задан, Vite ссылается на «/assets/…», а этот путь на боевом
// сервере принадлежит публичной части: админка откроется пустой страницей.
// Такая ошибка не видна ни в типах, ни в самой сборке, поэтому проверяем файл.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const html = readFileSync(join(distDir, 'index.html'), 'utf8');

const wrong = [...html.matchAll(/["'(](\/assets\/[^"')]+)["')]/g)].map((match) => match[1]);
const right = [...html.matchAll(/["'(](\/admin\/assets\/[^"')]+)["')]/g)].map((match) => match[1]);

if (wrong.length > 0 || right.length === 0) {
  console.error(
    `Сборка админки: базовый путь не применён (найдено ${wrong.length} ссылок на /assets/). ` +
      'Проверьте base в vite.config.ts.'
  );
  process.exit(1);
}

console.log(`Админка: базовый путь /admin/ подтверждён (${right.length} ссылок на /admin/assets/…)`);
