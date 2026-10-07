// Выгрузка таблиц в XLSX без внешних зависимостей (ТЗ 07, п. 1.8).
//
// Требование: списки админки выгружаются и в CSV, и в XLSX. Библиотеку для этого
// тянуть не стали: XLSX — это ZIP с несколькими XML-файлами, а ZIP с методом
// «без сжатия» собирается вручную за десяток строк. Так выгрузка работает и в
// браузере (админка собирает файл из уже загруженных строк), и на сервере — без
// новых зависимостей в бандле.
//
// Значения пишутся как inline-строки: это избавляет от отдельной таблицы
// sharedStrings и от расхождений в экранировании.

/** CRC-32 для записей ZIP (стандартный полином, таблица считается один раз). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Собирает ZIP-архив без сжатия (метод 0). */
function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // сигнатура локального заголовка
    localView.setUint16(4, 20, true); // версия для распаковки
    localView.setUint16(6, 0x0800, true); // имена в UTF-8
    localView.setUint16(8, 0, true); // метод: без сжатия
    localView.setUint16(10, 0, true); // время
    localView.setUint16(12, 0, true); // дата
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, entry.data);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true); // сигнатура центрального каталога
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // сигнатура конца каталога
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const total = all.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(total);
  let position = 0;
  for (const item of all) {
    result.set(item, position);
    position += item.length;
  }
  return result;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Номер колонки в буквенном виде: 1 → A, 27 → AA. */
function columnName(index: number): string {
  let value = index;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export type XlsxCell = string | number | null | undefined;

/** Формирует XLSX (одна книга, один лист) и возвращает байты файла. */
export function buildXlsx(sheetTitle: string, headers: string[], rows: XlsxCell[][]): Uint8Array {
  const encoder = new TextEncoder();

  const rowXml = (cells: XlsxCell[], rowIndex: number): string => {
    const cellsXml = cells
      .map((cell, cellIndex) => {
        const reference = `${columnName(cellIndex + 1)}${rowIndex}`;
        if (cell === null || cell === undefined || cell === '') return '';
        if (typeof cell === 'number' && Number.isFinite(cell)) {
          return `<c r="${reference}"><v>${cell}</v></c>`;
        }
        return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`;
      })
      .join('');
    return `<row r="${rowIndex}">${cellsXml}</row>`;
  };

  const sheetRows = [rowXml(headers, 1), ...rows.map((row, index) => rowXml(row, index + 2))].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(
    sheetTitle.slice(0, 31)
  )}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  return zipStore([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet) },
  ]);
}

/** Готовый файл для сохранения в браузере. */
export function xlsxBlob(sheetTitle: string, headers: string[], rows: XlsxCell[][]): Blob {
  const bytes = buildXlsx(sheetTitle, headers, rows);
  // Копия нужна, потому что Uint8Array может быть представлением общего буфера.
  return new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
