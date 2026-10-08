import { inflateRawSync } from 'node:zlib';

// Чтение ZIP-архивов без внешних библиотек.
//
// Нужно в двух местах: разбор XLSX (это ZIP с XML) и проверка собранных DOCX —
// в тестах документ открывается тем же кодом, которым читаются таблицы. Размеры
// записей берутся из центрального каталога: Excel, LibreOffice и Word пишут файлы
// с флагом data descriptor, где в локальном заголовке размеры нулевые, и чтение
// только локальных заголовков обрывается ошибкой распаковки.

export interface ZipEntry {
  name: string;
  /** 0 — без сжатия, 8 — deflate. */
  method: number;
  data: Buffer;
}

/** Читает записи архива: имя, метод сжатия и распакованное содержимое. */
export function readZipArchive(buffer: Buffer): ZipEntry[] {
  // Конец центрального каталога ищется от конца файла: перед ним может стоять
  // комментарий архива длиной до 65 535 байт.
  let eocd = -1;
  const lowest = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) throw new Error('Файл не похож на архив: не найден каталог');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');

    // Смещение данных — через локальный заголовок: длины имени и дополнительного
    // поля в нём могут отличаться от каталога.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, method, data: method === 8 ? inflateRawSync(data) : Buffer.from(data) });

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
