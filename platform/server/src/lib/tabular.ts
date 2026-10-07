import { inflateRawSync } from 'node:zlib';

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

interface ZipEntryInfo {
  name: string;
  method: number;
  data: Buffer;
}

/**
 * Читает записи ZIP (методы «без сжатия» и deflate).
 *
 * Размеры берутся из центрального каталога, а не из локального заголовка: Excel и
 * LibreOffice пишут файлы с флагом data descriptor, где в локальном заголовке
 * размеры нулевые, а настоящие лежат в каталоге. Чтение только локальных
 * заголовков на таких файлах обрывается ошибкой распаковки.
 */
function readZipEntries(buffer: Buffer): ZipEntryInfo[] {
  // Конец центрального каталога: сигнатура ищется от конца файла (перед ней
  // может стоять комментарий архива длиной до 65 535 байт).
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 22 - 65535; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) throw new Error('Файл не похож на архив XLSX: не найден каталог');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntryInfo[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');

    // Смещение данных — через локальный заголовок: в нём свои длины имени и
    // дополнительного поля, и они могут отличаться от каталога.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, method, data: method === 8 ? inflateRawSync(data) : Buffer.from(data) });

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
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
  const entries = readZipEntries(buffer);
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
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (isZip || fileName.toLowerCase().endsWith('.xlsx')) return parseXlsx(buffer);
  return parseCsv(buffer.toString('utf8'));
}
