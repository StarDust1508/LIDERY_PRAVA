import { readZipArchive } from './zip.js';

// Разбор табличных файлов для массового импорта (ТЗ 07, п. 2.14а).
//
// Требование: импорт CSV/XLSX с предпросмотром. Библиотеки для разбора не
// подключаем: CSV разбирается вручную (нужны кавычки, точки с запятой и запятые
// как разделители), XLSX — это ZIP с XML, а Node умеет распаковывать записи
// методом deflate из коробки. Так импорт работает без новых зависимостей и без
// ограничений на размер файла в памяти сервера.

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** Что распознано: csv или xlsx — для понятного сообщения в интерфейсе. */
  format: 'csv' | 'xlsx';
}

/** Разбирает CSV: разделитель определяется по первой строке. */
export function parseCsv(text: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ';': (firstLine.match(/;/g) ?? []).length, ',': (firstLine.match(/,/g) ?? []).length, '\t': (firstLine.match(/\t/g) ?? []).length };
  const delimiter =
    counts[';'] >= counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ',';

  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      current.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  if (field !== '' || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  const nonEmpty = rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((cell) => cell.trim());
  return { headers, rows: nonEmpty.map((row) => headers.map((_, index) => (row[index] ?? '').trim())), format: 'csv' };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Номер колонки из ссылки вида «BC12». */
function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Z]/g, '');
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Разбирает XLSX: значения берутся из общего списка строк или из ячеек. */
export function parseXlsx(buffer: Buffer): ParsedTable {
  const entries = readZipArchive(buffer);
  const sheet =
    entries.find((entry) => /^xl\/worksheets\/sheet1\.xml$/.test(entry.name)) ??
    entries.find((entry) => /^xl\/worksheets\/.+\.xml$/.test(entry.name));
  if (!sheet) throw new Error('В файле не найден лист с данными');

  const sharedEntry = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = sharedEntry.data.toString('utf8');
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const text = [...(match[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => decodeXml(part[1] ?? ''))
        .join('');
      shared.push(text);
    }
  }

  const sheetXml = sheet.data.toString('utf8');
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
      const index = reference ? columnIndex(reference) : cells.length;
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1] ?? '')).join('');
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        value = type === 's' ? shared[Number(raw)] ?? '' : decodeXml(raw);
      }
      while (cells.length < index) cells.push('');
      cells[index] = value.trim();
    }
    rows.push(cells);
  }

  const nonEmpty = rows.filter((row) => row.some((cell) => (cell ?? '').trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((cell) => (cell ?? '').trim());
  return { headers, rows: nonEmpty.map((row) => headers.map((_, index) => (row[index] ?? '').trim())), format: 'xlsx' };
}

/** Определяет формат по содержимому и разбирает файл. */
export function parseTableFile(buffer: Buffer, fileName: string): ParsedTable {
  // Формат определяется по сигнатуре архива: файл с расширением .xlsx, внутри
  // которого текст, разберётся как CSV с понятным сообщением о колонках, а не
  // упадёт с ошибкой распаковки. Имя файла используется только в сообщениях.
  const isZip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (isZip) return parseXlsx(buffer);
  void fileName;
  return parseCsv(buffer.toString('utf8'));
}
