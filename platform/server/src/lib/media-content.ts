// Типы файлов, которые можно загрузить в хранилище. Видео не загружается:
// видеоролик первого этапа публикуется во «ВКонтакте», в заявке хранится ссылка
// (см. тип материала video_link).
export const ALLOWED_UPLOAD_MIMES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const ZIP_MIMES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function isAllowedUploadMime(mime: string): boolean {
  return ALLOWED_UPLOAD_MIMES.includes(mime);
}

/**
 * Проверка magic-байтов: заявленный MIME должен совпадать с реальным
 * содержимым файла. Без этой проверки под видом картинки можно загрузить
 * произвольный файл (см. разбор рисков переноса ядра, п. 3.1).
 */
export function hasValidSignature(file: Pick<Express.Multer.File, 'buffer' | 'mimetype'>): boolean {
  const buffer = file.buffer;
  if (!buffer || buffer.length < 4) return false;

  if (file.mimetype === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (file.mimetype === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (file.mimetype === 'image/gif') {
    return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  }
  if (file.mimetype === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (file.mimetype === 'image/avif') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
      buffer.subarray(8, 12).toString('ascii').includes('avif')
    );
  }
  if (file.mimetype === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (ZIP_MIMES.includes(file.mimetype)) {
    // Все форматы Office (docx/pptx/xlsx) — это ZIP-контейнеры.
    const head = buffer.subarray(0, 4);
    return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
  }
  return false;
}

/** Разрешённые типы материалов заявки и понятные подписи для интерфейса. */
export const MATERIAL_TYPES = {
  law_draft: 'Текст законопроекта',
  explanatory_note: 'Пояснительная записка',
  acts_list: 'Перечень актов',
  comparison_table: 'Сравнительная таблица',
  video_link: 'Ссылка на видеоролик',
  presentation: 'Презентация',
  consent: 'Согласие на обработку персональных данных',
  other: 'Иной материал',
} as const;

export type MaterialType = keyof typeof MATERIAL_TYPES;

export function isMaterialType(value: unknown): value is MaterialType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MATERIAL_TYPES, value);
}

/** Понятная подпись типа материала; для неизвестного значения — исходная строка. */
export function materialTypeTitle(value: unknown): string {
  return isMaterialType(value) ? MATERIAL_TYPES[value] : String(value ?? '');
}

/** Типы материалов, которые передаются ссылкой, а не файлом. */
export const LINK_ONLY_MATERIAL_TYPES: readonly MaterialType[] = ['video_link'];

/** Типы материалов, для которых ссылка допустима наравне с файлом. */
export const LINK_ALLOWED_MATERIAL_TYPES: readonly MaterialType[] = ['video_link', 'presentation', 'other'];

/** Санитизация имени файла: убираем управляющие символы и ограничиваем длину. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'file';
}
