// Типы файлов, которые можно загрузить в хранилище. Видео не загружается:
// видеоролик первого этапа публикуется во «ВКонтакте», в заявке хранится ссылка
// (см. тип материала video_link).
//
// Перечень — по ТЗ 11, п. 4.1: PDF, DOC, DOCX, RTF, ODT, XLS, XLSX, PPT, PPTX,
// PNG, JPEG, ZIP. Проверяются три вещи независимо: расширение имени, заявленный
// MIME и magic-байты содержимого (п. 4.2). SVG намеренно не разрешён: он умеет
// исполнять скрипты и потому не является «просто картинкой».
export const ALLOWED_UPLOAD_MIMES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'application/msword',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
];

/**
 * Разрешённые расширения имени файла (ТЗ 11, п. 4.1).
 * Расширение проверяется отдельно от MIME: заявленный тип берётся из заголовка
 * запроса и подделывается тривиально.
 */
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc',
  'docx',
  'rtf',
  'odt',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'zip',
];

/**
 * Исполняемые и опасные расширения (ТЗ 11, п. 4.5). Список шире требуемых шести:
 * кроме .exe, .sh, .js, .php, .py, .html закрыты сценарии Windows, Java, Perl,
 * Ruby, серверные страницы и .svg (исполняемый в браузере XML).
 */
export const DENIED_UPLOAD_EXTENSIONS: readonly string[] = [
  'exe', 'sh', 'bash', 'zsh', 'js', 'mjs', 'cjs', 'php', 'phtml', 'py', 'pyc',
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'xml', 'xsl',
  'bat', 'cmd', 'com', 'scr', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh', 'hta',
  'jar', 'msi', 'dll', 'so', 'dylib', 'bin', 'apk', 'deb', 'rpm',
  'pl', 'pm', 'cgi', 'rb', 'asp', 'aspx', 'jsp', 'jspx', 'war',
];

/** Расширение имени файла в нижнем регистре; пустая строка, если его нет. */
export function fileExtension(name: string): string {
  const clean = String(name ?? '').trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).replace(/[^a-z0-9]/g, '');
}

/** Проверка расширения: сначала запрещённые, затем белый список. */
export function checkUploadExtension(name: string): { ok: true; extension: string } | { ok: false; reason: string } {
  const extension = fileExtension(name);
  if (extension === '') {
    return { ok: false, reason: 'У файла нет расширения: укажите тип файла в имени' };
  }
  if (DENIED_UPLOAD_EXTENSIONS.includes(extension)) {
    return { ok: false, reason: `Файлы .${extension} не принимаются: исполняемые файлы запрещены` };
  }
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      reason: `Формат .${extension} не принимается. Допустимы: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}`,
    };
  }
  return { ok: true, extension };
}

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
  // Форматы Office 97–2003 (doc/xls/ppt) — контейнер OLE2.
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(file.mimetype)) {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (file.mimetype === 'application/rtf' || file.mimetype === 'text/rtf') {
    return buffer.subarray(0, 5).toString('ascii') === '{\\rtf';
  }
  if (ZIP_MIMES.includes(file.mimetype)) {
    // Все форматы Office (docx/pptx/xlsx) — это ZIP-контейнеры.
    const head = buffer.subarray(0, 4);
    return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
  }
  if (file.mimetype === 'application/vnd.oasis.opendocument.text') {
    // ODT — тоже ZIP-контейнер, но с файлом mimetype внутри; проверяем по началу.
    const head = buffer.subarray(0, 4);
    return head[0] === 0x50 && head[1] === 0x4b;
  }
  if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed') {
    const head = buffer.subarray(0, 4);
    return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
  }
  return false;
}

/** Разрешённые типы материалов заявки и понятные подписи для интерфейса. */
// Перечень совпадает с ограничением application_materials.type в БД
// (миграции 004 и 013): новый код нельзя добавить только здесь.
export const MATERIAL_TYPES = {
  // Заявка формируется системой (Приложение № 1) и не загружается файлом.
  application_form: 'Заявка на участие (формируется системой)',
  law_draft: 'Текст законопроекта',
  explanatory_note: 'Пояснительная записка',
  acts_list: 'Перечень актов',
  comparison_table: 'Сравнительная таблица',
  video_link: 'Ссылка на видеоролик',
  presentation: 'Презентация',
  // Справка об обучении либо копия документа об образовании (финальный этап).
  status_proof: 'Справка о статусе участника',
  consent: 'Согласие на обработку персональных данных',
  consent_pdn: 'Согласие на обработку персональных данных',
  // Скан подписанного бланка Приложения № 11 — единственный случай, когда
  // согласие загружается файлом (п. 4.8, 7.2 Положения).
  consent_legal_rep: 'Согласие законного представителя (скан)',
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
