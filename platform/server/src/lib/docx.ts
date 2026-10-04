import { deflateRawSync } from 'node:zlib';

// Минимальный писатель DOCX без внешних зависимостей.
//
// DOCX — это ZIP-контейнер с XML-частями (WordprocessingML). Своя реализация
// нужна потому, что список зависимостей сервера ограничен разделом 1 ТЗ, а
// генерация бланков обязательна (пакет 2: заявка по Приложению № 1 и бланки
// согласий). Пишем только то, что действительно используем: абзацы, таблицы,
// прямое форматирование — без стилей и колонтитулов.

// ── ZIP (метод deflate) ──────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** Собирает ZIP-архив из частей документа. */
function createZip(entries: ZipEntry[], now: Date): Buffer {
  const { time: dosTime, date: dosDate } = dosDateTime(now);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // имена файлов в UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuffer, end]);
}

// ── WordprocessingML ─────────────────────────────────────────────────────────
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ParagraphOptions {
  bold?: boolean;
  italic?: boolean;
  /** Размер в полупунктах: 24 = 12 pt. */
  size?: number;
  align?: 'left' | 'center' | 'right' | 'both';
  spaceAfter?: number;
  caps?: boolean;
}

function runProperties(options: ParagraphOptions): string {
  const parts: string[] = [];
  if (options.bold) parts.push('<w:b/>');
  if (options.italic) parts.push('<w:i/>');
  if (options.caps) parts.push('<w:caps/>');
  if (options.size) parts.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);
  parts.push('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>');
  return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

/** Абзац с одним текстовым фрагментом. Пустой текст даёт пустой абзац. */
export function paragraph(text: string, options: ParagraphOptions = {}): string {
  const properties: string[] = [];
  if (options.align) properties.push(`<w:jc w:val="${options.align}"/>`);
  if (options.spaceAfter !== undefined) properties.push(`<w:spacing w:after="${options.spaceAfter}"/>`);
  const pPr = properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
  const runs =
    text === ''
      ? ''
      : `<w:r>${runProperties(options)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  return `<w:p>${pPr}${runs}</w:p>`;
}

interface TableOptions {
  header?: [string, string];
  /** Ширины колонок в twips (1/20 пункта); сумма — ширина полосы набора. */
  widths?: [number, number];
  labelBold?: boolean;
}

function tableCell(text: string, width: number, bold: boolean): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
    paragraph(text, { bold, size: 22 }) +
    '</w:tc>'
  );
}

/** Таблица «Показатель — Сведения» с необязательной шапкой. */
export function table(rows: Array<[string, string]>, options: TableOptions = {}): string {
  const widths = options.widths ?? [3600, 5600];
  const borders =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`)
      .join('') +
    '</w:tblBorders>';

  const headerRow = options.header
    ? `<w:tr>${tableCell(options.header[0], widths[0], true)}${tableCell(options.header[1], widths[1], true)}</w:tr>`
    : '';
  const bodyRows = rows
    .map(
      ([label, value]) =>
        `<w:tr>${tableCell(label, widths[0], options.labelBold ?? false)}${tableCell(value, widths[1], false)}</w:tr>`
    )
    .join('');

  return (
    '<w:tbl><w:tblPr>' +
    '<w:tblW w:w="9200" w:type="dxa"/>' +
    borders +
    '</w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${widths[0]}"/><w:gridCol w:w="${widths[1]}"/></w:tblGrid>` +
    headerRow +
    bodyRows +
    '</w:tbl>' +
    // Word требует абзац после таблицы, иначе следующая таблица сливается.
    paragraph('', { size: 12 })
  );
}

/** Собирает готовый .docx из тела документа. */
export function buildDocx(bodyXml: string, now: Date = new Date()): Buffer {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr>' +
    '</w:body></w:document>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const relationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  return createZip(
    [
      { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
      { name: '_rels/.rels', data: Buffer.from(relationships, 'utf8') },
      { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
    ],
    now
  );
}
