import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildXlsx, xlsxBlob } from './xlsx.js';

// Проверки выгрузки XLSX (ТЗ 07, п. 1.8). Файл собирается вручную, поэтому
// проверяем структуру архива и разметку листа независимым разбором: тест не
// использует код записи, а читает байты заново.

interface Entry {
  name: string;
  text: string;
}

/** Разбор ZIP по локальным заголовкам: записи без сжатия либо deflate. */
function readZip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    assert.equal(method, 0, 'записи XLSX должны храниться без сжатия');
    entries.push({ name, text: decoder.decode(data) });
    offset = dataStart + size;
  }

  assert.equal(view.getUint32(offset, true), 0x02014b50, 'после записей должен идти центральный каталог');
  return entries;
}

function sheetOf(entries: Entry[]): string {
  const sheet = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml');
  assert.ok(sheet, 'в архиве должен быть лист xl/worksheets/sheet1.xml');
  return sheet.text;
}

test('XLSX — это корректный ZIP с обязательными частями', () => {
  const bytes = buildXlsx('Команды', ['Название'], [['Альфа']]);
  const entries = readZip(bytes);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']
  );

  const contentTypes = entries[0]!.text;
  assert.match(contentTypes, /spreadsheetml\.sheet\.main\+xml/);
  assert.match(contentTypes, /spreadsheetml\.worksheet\+xml/);

  const workbook = entries.find((entry) => entry.name === 'xl/workbook.xml')!.text;
  assert.match(workbook, /name="Команды"/);
  assert.match(workbook, /r:id="rId1"/);
});

test('заголовок и строки попадают на лист в правильные ячейки', () => {
  const bytes = buildXlsx('Список', ['Команда', 'Балл'], [['Альфа', 42], ['Бета', 7.5]]);
  const sheet = sheetOf(readZip(bytes));

  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">Команда<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B1" t="inlineStr"><is><t xml:space="preserve">Балл<\/t><\/is><\/c>/);
  // Числа пишутся значениями, а не строками: в Excel по ним считается сумма.
  assert.match(sheet, /<c r="B2"><v>42<\/v><\/c>/);
  assert.match(sheet, /<c r="B3"><v>7.5<\/v><\/c>/);
  assert.match(sheet, /<c r="A3" t="inlineStr"><is><t xml:space="preserve">Бета<\/t><\/is><\/c>/);
  assert.match(sheet, /<row r="3">/);
});

test('пустые значения пропускаются, а не превращаются в мусор', () => {
  const sheet = sheetOf(readZip(buildXlsx('Т', ['A', 'B', 'C'], [['есть', null, undefined], ['', 0, '']])));
  // Пустых ячеек в разметке нет вовсе.
  assert.ok(!sheet.includes('r="B2"'));
  assert.ok(!sheet.includes('r="C2"'));
  assert.ok(!sheet.includes('r="A3"'));
  // Ноль — это значение, его терять нельзя.
  assert.match(sheet, /<c r="B3"><v>0<\/v><\/c>/);
  // Строка тоже остаётся в разметке, даже если все ячейки пустые.
  assert.match(sheet, /<row r="3">/);
});

test('опасные символы экранируются — файл остаётся валидным XML', () => {
  const tricky = 'ООО «Ромашка & Ко» <тест> "кавычки" \'одинарные\'';
  const sheet = sheetOf(readZip(buildXlsx('Т', ['Комментарий'], [[tricky]])));
  assert.ok(sheet.includes('&amp;'), 'амперсанд должен быть экранирован');
  assert.ok(!sheet.includes('& Ко'), 'неэкранированного амперсанда быть не должно');
  assert.ok(sheet.includes('&lt;тест&gt;'));
  assert.ok(sheet.includes('&quot;кавычки&quot;'));
  assert.ok(sheet.includes('&apos;одинарные&apos;'));

  // Номер строки/столбца берётся из позиции, поэтому кавычки в значении не ломают разметку.
  const decoded = sheet
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  assert.ok(decoded.includes(tricky), 'после обратного разбора значение должно совпасть');
});

test('название листа обрезается до 31 символа и тоже экранируется', () => {
  const long = 'Очень длинное название листа выгрузки, которое точно больше тридцати одного символа';
  const workbook = readZip(buildXlsx(long, ['A'], [])).find((entry) => entry.name === 'xl/workbook.xml')!.text;
  const name = /name="([^"]*)"/.exec(workbook)![1]!;
  assert.equal(name.length, 31);
  assert.ok(long.startsWith(name));

  const ampersand = readZip(buildXlsx('Итоги & протокол', ['A'], []))
    .find((entry) => entry.name === 'xl/workbook.xml')!.text;
  assert.match(ampersand, /name="Итоги &amp; протокол"/);
});

test('заголовки длиннее 26 колонок получают правильные буквы', () => {
  const headers = Array.from({ length: 28 }, (_, index) => `К${index + 1}`);
  const sheet = sheetOf(readZip(buildXlsx('Ш', headers, [])));
  assert.match(sheet, /<c r="Z1"/);
  assert.match(sheet, /<c r="AA1"/);
  assert.match(sheet, /<c r="AB1"/);
});

test('большая выгрузка не теряет строк и остаётся разбираемой', () => {
  const rows = Array.from({ length: 500 }, (_, index) => [`Команда ${index + 1}`, index * 1.5]);
  const bytes = buildXlsx('Команды', ['Название', 'Балл'], rows);
  const entries = readZip(bytes);
  const sheet = sheetOf(entries);
  assert.equal((sheet.match(/<row /g) ?? []).length, 501, 'строка заголовка плюс все строки данных');
  assert.match(sheet, /<c r="A501"[^>]*><is><t[^>]*>Команда 500<\/t>/);
  // Разбор всего файла подтверждает, что размеры в заголовках не разъехались.
  assert.equal(entries.length, 5);
});

test('xlsxBlob отдаёт файл с правильным типом для скачивания', async () => {
  const blob = xlsxBlob('Команды', ['Название'], [['Альфа']]);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'файл должен начинаться с сигнатуры ZIP');
  assert.deepEqual([...buildXlsx('Команды', ['Название'], [['Альфа']])], [...bytes]);
});
