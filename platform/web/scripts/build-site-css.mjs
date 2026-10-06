#!/usr/bin/env node
// Перенос оформления прежнего сайта конкурса в сборку.
//
// Зачем скрипт, а не скопированный вручную файл: вёрстка прежнего сайта —
// источник оформления (ТЗ 08, п. 9.1: новый бренд не изобретается). Скрипт
// читает <style> из legacy-разметки, ограничивает правила областью .site и
// записывает src/site/site.css. Так оформление публичной части остаётся ровно
// таким, как на прежнем сайте, а служебные экраны (мастер, кабинет, админка)
// не получают глобальных переопределений.
//
// Запуск: node scripts/build-site-css.mjs  (файл site.css попадает в сборку)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
// Два источника оформления прежнего сайта: главная страница (блоки, hero,
// сетки, подвал) и страница «Победители» (внутренние страницы: phero, крошки,
// архив по годам). Порядок важен: правила внутренних страниц идут после главных
// и уточняют их.
const SOURCES = ['index.html', 'pobediteli.html', 'redesign/prototype.html'];

const parts = [];
const used = [];
for (const relative of SOURCES) {
  const file = join(repoRoot, relative);
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
  if (styles.length === 0) continue;
  parts.push(styles.sort((a, b) => b.length - a.length)[0]);
  used.push(relative);
}

if (parts.length === 0) {
  console.error('Не найдены встроенные стили прежнего сайта (index.html, pobediteli.html).');
  process.exit(1);
}
const css = parts.join('\n\n');
const sourceList = used.join(', ');

/** Префикс области: служебные экраны платформы стили прежнего сайта не получают. */
const SCOPE = '.site';
const ROOT_SELECTORS = new Set([':root', 'html', 'body', '*']);

const root = postcss.parse(css);

// Слова, которых в оформлении быть не должно: это названия других проектов и
// их схем данных. В прежней вёрстке остались классы от прошлых версий сайта —
// переносить их в платформу нельзя (гейты разделения, ТЗ 03, п. 6).
const FORBIDDEN = /pravotech|tech-pravo|expertum|neuropravo|techtravoai|bankruptcy|ba_app/i;

root.walkAtRules((atRule) => {
  // Шрифты в сборке локальные: подключение прежнего сайта не переносим.
  if (atRule.name === 'import' && /fonts\.css/.test(atRule.params)) atRule.remove();
});

root.walkRules((rule) => {
  if (rule.selector && FORBIDDEN.test(rule.selector)) {
    console.warn(`Оформление: правило исключено (чужое название в селекторе): ${rule.selector}`);
    rule.remove();
  }
});

root.walkRules((rule) => {
  // Содержимое @keyframes и @font-face не является селекторами.
  const parent = rule.parent;
  if (parent && parent.type === 'atrule' && /keyframes|font-face/i.test(parent.name)) return;
  if (!rule.selector) return;

  const scoped = rule.selectors.map((selector) => {
    const clean = selector.trim();
    if (!clean) return clean;
    if (ROOT_SELECTORS.has(clean)) return SCOPE;
    if (clean.startsWith(`${SCOPE} `) || clean === SCOPE) return clean;
    if (/^(html|body)\b/.test(clean)) return clean.replace(/^(html|body)/, SCOPE);
    if (clean.startsWith(':root')) return clean.replace(':root', SCOPE);
    return `${SCOPE} ${clean}`;
  });

  rule.selectors = scoped;
});

const header = `/* ============================================================================
   Оформление прежнего сайта конкурса «Лидеры права».
   Файл создан скриптом platform/web/scripts/build-site-css.mjs из вёрстки
   прежней площадки (${sourceList}). Правки вносить в
   источник и пересобирать: иначе оформление разойдётся с прежним сайтом.
   Стили ограничены областью .site — служебные экраны платформы не затронуты.
   ========================================================================== */

`;

const outDir = resolve(here, '../src/site');
mkdirSync(outDir, { recursive: true });
const target = join(outDir, 'site.css');
writeFileSync(target, header + root.toString(), 'utf8');

const rules = root.nodes.filter((node) => node.type === 'rule').length;
console.log(`Оформление прежнего сайта перенесено: ${target} (правил верхнего уровня: ${rules})`);
