import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { parseCsv, parseTableFile, parseXlsx } from './tabular.js';

// Разбор табличных файлов для импорта архива (ТЗ 07, п. 2.14а).
//
// Проверяются обе стороны: CSV с кавычками и разделителями и XLSX — как
// собранный системной выгрузкой, так и сжатый офисным пакетом (deflate).

test('CSV разбирается с точкой с запятой и запятой', () => {
  const semicolon = parseCsv('Название;Команда\n"Работа; с точкой с запятой";Команда\n');
  assert.deepEqual(semicolon.headers, ['Название', 'Команда']);
  assert.deepEqual(semicolon.rows, [['Работа; с точкой с запятой', 'Команда']]);
  assert.equal(semicolon.format, 'csv');

  const comma = parseCsv('title,team\nРабота,Команда\n');
  assert.deepEqual(comma.headers, ['title', 'team']);
  assert.deepEqual(comma.rows, [['Работа', 'Команда']]);
});

test('CSV: кавычки, переводы строк внутри поля и BOM', () => {
  const text = '\uFEFFНазвание;Аннотация\n"Работа ""в кавычках""";"Первая строка\nвторая строка"\n';
  const parsed = parseCsv(text);
  assert.deepEqual(parsed.headers, ['Название', 'Аннотация']);
  assert.equal(parsed.rows[0]?.[0], 'Работа "в кавычках"');
  assert.equal(parsed.rows[0]?.[1], 'Первая строка\nвторая строка');
});

test('CSV: пустые строки пропускаются, недостающие ячейки заполняются', () => {
  const parsed = parseCsv('a;b;c\n1;2\n\n3;4;5\n');
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], ['1', '2', '']);
  assert.deepEqual(parsed.rows[1], ['3', '4', '5']);
});

test('XLSX системной выгрузки (inline-строки) читается обратно', () => {
  // Разметка повторяет выгрузку админки: значения записаны прямо в ячейках.
  const bytes = buildInlineXlsx(['Название', 'Год', 'Место'], [['Работа', 2024, 1], ['Работа «два» & Ко', 2025, 2]]);
  const parsed = parseXlsx(bytes);
  assert.deepEqual(parsed.headers, ['Название', 'Год', 'Место']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.[0], 'Работа');
  // Числа приходят как значения, а не как текст.
  assert.equal(parsed.rows[0]?.[1], '2024');
  // Экранирование XML не должно оставлять следов в данных.
  assert.equal(parsed.rows[1]?.[0], 'Работа «два» & Ко');
});

test('XLSX с сжатием (deflate) читается: так пишут Excel и LibreOffice', () => {
  // Собираем архив вручную: одна сжатая запись с данными листа и таблица строк.
  const sharedStrings = `<?xml version="1.0"?><sst><si><t>Название</t></si><si><t>Команда из Excel</t></si><si><t>Место</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row>` +
    `</sheetData></worksheet>`;
  const archive = buildZip([
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStrings, 'utf8'), deflate: true },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8'), deflate: true },
  ]);

  const parsed = parseXlsx(archive);
  assert.deepEqual(parsed.headers, ['Название', 'Место']);
  assert.deepEqual(parsed.rows, [['Команда из Excel', '42']]);
});

test('формат определяется по содержимому, а не по имени файла', () => {
  const bytes = buildInlineXlsx(['Название'], [['Работа']]);
  // Имя без расширения, но содержимое — ZIP.
  assert.equal(parseTableFile(bytes, 'выгрузка').format, 'xlsx');
  // Имя с расширением .xlsx, содержимое — текст: разбирается как CSV.
  assert.equal(parseTableFile(Buffer.from('Название\nРабота\n', 'utf8'), 'файл.xlsx').format, 'csv');
});

test('битый файл даёт понятную ошибку, а не падение', () => {
  assert.throws(() => parseXlsx(Buffer.from('не архив', 'utf8')), /не похож на архив/);
});

test('файл на диске читается тем же разбором', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liders-tabular-'));
  const path = join(dir, 'выгрузка.csv');
  writeFileSync(path, 'Название;Команда\nРабота;Команда\n', 'utf8');
  const parsed = parseTableFile(readFileSync(path), 'выгрузка.csv');
  assert.equal(parsed.rows.length, 1);
});

/** Собирает XLSX с inline-строками — так же, как выгрузка админки. */
function buildInlineXlsx(headers: string[], rows: Array<Array<string | number>>): Buffer {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const column = (position: number): string => String.fromCharCode(64 + position);
  const rowXml = (cells: Array<string | number>, rowNumber: number): string =>
    `<row r="${rowNumber}">${cells
      .map((cell, index) =>
        typeof cell === 'number'
          ? `<c r="${column(index + 1)}${rowNumber}"><v>${cell}</v></c>`
          : `<c r="${column(index + 1)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${escape(cell)}</t></is></c>`
      )
      .join('')}</row>`;

  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${[rowXml(headers, 1), ...rows.map((row, index) => rowXml(row, index + 2))].join('')}</sheetData></worksheet>`;
  return buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') }]);
}

/** Собирает ZIP-архив с возможностью сжатия записей (для проверки deflate). */
function buildZip(
  entries: Array<{ name: string; data: Buffer; deflate?: boolean }>
): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const payload = entry.deflate === true ? deflateRawSync(entry.data) : entry.data;
    const method = entry.deflate === true ? 8 : 0;

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    chunks.push(local, payload);

    const head = Buffer.alloc(46 + nameBytes.length);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt32LE(payload.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    nameBytes.copy(head, 46);
    central.push(head);

    offset += local.length + payload.length;
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, ...central, end]);
}
