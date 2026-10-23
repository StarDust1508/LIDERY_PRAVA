#!/usr/bin/env node
// Сверка контента сайта с официальными документами конкурса.
//
// Зачем: критерии, направления, материалы, номинации и приложения не должны
// набираться руками и расходиться с Положением. Скрипт вынимает текст из DOCX
// (unzip + word/document.xml, без зависимостей) и проверяет, что каждая запись
// `platform/content/regulation-2026.json` присутствует в документе дословно
// (с точностью до типографики: ё/е, кавычки, тире, регистр), а суммы и
// количества совпадают.
//
// Запуск: node platform/scripts/verify-content.mjs --regulation /путь/Положение.docx --appendices /путь/Приложения.docx
// Выход: 0 — всё совпало, 1 — есть расхождения (список печатается).

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const contentPath = join(root, 'platform/content/regulation-2026.json');

// ── извлечение текста из DOCX без внешних зависимостей ─────────────────────
function docxText(file) {
  const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const withBreaks = xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\/>/g, '\n');
  return withBreaks.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Нормализация: сравниваем смысл, а не кодировку символов.
function norm(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[ \s]+/g, ' ')
    .trim();
}

const raw = readFileSync(contentPath, 'utf8');
const content = JSON.parse(raw);

// ── где искать документы ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const docArgs = [];
let explicitRegulation = null;
let explicitAppendices = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--docs') docArgs.push(args[i + 1]);
  if (args[i] === '--regulation') explicitRegulation = args[i + 1];
  if (args[i] === '--appendices') explicitAppendices = args[i + 1];
}

function findDoc(namePart) {
  const exact = docArgs.find((file) => file.includes(namePart));
  const candidates = [...docArgs];
  const dirs = [join(root, 'docs/source'), join(root, 'docs'), join(root, 'platform/content')];
  for (const dir of dirs) {
    try {
      for (const entry of readdirSync(dir)) if (entry.includes(namePart) && entry.endsWith('.docx')) candidates.push(join(dir, entry));
    } catch {
      /* каталога нет */
    }
  }
  if (exact) return exact;
  return candidates.find((file) => {
    try {
      readFileSync(file);
      return true;
    } catch {
      return false;
    }
  });
}

const regulationFile = explicitRegulation ?? findDoc('Положение');
const appendicesFile = explicitAppendices ?? findDoc('Приложени');
if (!regulationFile) {
  console.error('НЕ НАЙДЕН файл Положения (.docx). Передайте --docs путь/к/Положение_Лидеры_права.docx');
  process.exit(2);
}
if (!appendicesFile) {
  console.error('НЕ НАЙДЕН файл Приложений (.docx). Передайте --docs путь/к/Приложения_Лидеры_права.docx');
  process.exit(2);
}

const reg = norm(docxText(regulationFile));
const app = norm(docxText(appendicesFile));
const problems = [];
let checked = 0;

function expectIn(haystack, needle, label, haystackName) {
  checked += 1;
  if (!haystack.includes(norm(needle))) problems.push(`${label}: нет в «${haystackName}» — «${needle}»`);
}

// ── критерии: текст, баллы, суммы, количество ───────────────────────────────
for (const [stage, group] of Object.entries(content.criteria)) {
  const sum = group.items.reduce((acc, item) => acc + item.max, 0);
  if (sum !== group.max_total) problems.push(`критерии ${stage}: сумма ${sum}, а в источнике ${group.max_total}`);
  for (const item of group.items) {
    expectIn(reg, item.title, `критерий ${item.code}`, 'Положение');

  }
  console.log(`  критерии ${stage}: ${group.items.length} шт., сумма ${sum} (в источнике ${group.max_total})`);
}
if (content.criteria.selection.items.length !== 7) problems.push('критериев отборочного этапа должно быть 7');
if (content.criteria.stage1.items.length !== 8) problems.push('критериев первого этапа должно быть 8 (п. 10.3)');
if (content.criteria.debate.items.length !== 5) problems.push('критериев дебатов должно быть 5 (п. 10.4)');

// ── направления ────────────────────────────────────────────────────────────
for (const item of content.directions.items) expectIn(app, item.title, `направление ${item.code}`, 'Приложения');
if (content.directions.items.length !== 7) problems.push('направлений должно быть 7 (Приложение № 2)');

// ── номинации ──────────────────────────────────────────────────────────────
for (const item of content.nominations.items) expectIn(reg, item.title, `номинация ${item.code}`, 'Положение');
if (content.nominations.items.length !== 6) problems.push('номинаций должно быть 6 (п. 11.1)');

// ── приложения ─────────────────────────────────────────────────────────────
for (const item of content.appendices.items) expectIn(app, `Приложение № ${item.number}`, `приложение ${item.number}`, 'Приложения');
if (content.appendices.items.length !== 17) problems.push('приложений должно быть 17 (редакция 21.10.2026)');

// ── материалы: обязательные позиции п. 7.2 ─────────────────────────────────
for (const item of content.materials.selection) {
  expectIn(reg, item.docAnchor, `материал ${item.type}`, 'Положение');
}
const required = content.materials.selection.filter((item) => item.required).map((item) => item.type);
for (const type of ['application_form', 'law_draft', 'explanatory_note', 'consent_pdn']) {
  if (!required.includes(type)) problems.push(`в п. 7.2 обязателен материал «${type}»`);
}

console.log(`\nПроверено записей: ${checked}`);
console.log(`Источник: ${regulationFile}`);
console.log(`Источник: ${appendicesFile}`);

if (problems.length) {
  console.error('\nРАСХОЖДЕНИЯ С ДОКУМЕНТАМИ:');
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}
console.log('\nКонтент совпадает с документами.');
