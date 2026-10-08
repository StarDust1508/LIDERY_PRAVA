import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DENIED_UPLOAD_EXTENSIONS,
  checkUploadExtension,
  fileExtension,
  hasValidSignature,
  isAllowedUploadMime,
  isMaterialType,
  materialTypeTitle,
  sanitizeFileName,
} from './media-content.js';

// Проверки загрузки файлов (ТЗ 11, п. 4.1–4.5). Тесты фиксируют правила,
// которые защищают от загрузки исполняемого файла под видом документа.

test('расширение извлекается в нижнем регистре', () => {
  assert.equal(fileExtension('Законопроект.PDF'), 'pdf');
  assert.equal(fileExtension('архив.tar.gz'), 'gz');
  assert.equal(fileExtension('без-расширения'), '');
  assert.equal(fileExtension('.скрытый'), '');
});

test('исполняемые расширения отклоняются с понятной причиной', () => {
  for (const name of ['virus.exe', 'script.sh', 'app.js', 'shell.php', 'run.py', 'page.html', 'pic.svg']) {
    const result = checkUploadExtension(name);
    assert.equal(result.ok, false, `${name} должен быть отклонён`);
    if (!result.ok) assert.match(result.reason, /не принимаются/);
  }
});

test('разрешённые расширения принимаются', () => {
  for (const name of ['законопроект.docx', 'записка.pdf', 'таблица.xlsx', 'скан.png', 'фото.jpeg']) {
    assert.equal(checkUploadExtension(name).ok, true, `${name} должен быть принят`);
  }
});

test('файл без расширения отклоняется', () => {
  const result = checkUploadExtension('документ');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /нет расширения/);
});

test('список запрещённых расширений включает требуемые ТЗ', () => {
  for (const extension of ['exe', 'sh', 'js', 'php', 'py', 'html']) {
    assert.ok(DENIED_UPLOAD_EXTENSIONS.includes(extension), `${extension} должен быть в списке`);
  }
});

test('magic-байты: PDF, PNG и подделка под PDF', () => {
  const pdf = Buffer.from('%PDF-1.7\n');
  assert.equal(hasValidSignature({ buffer: pdf, mimetype: 'application/pdf' }), true);

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(8),
  ]);
  assert.equal(hasValidSignature({ buffer: png, mimetype: 'image/png' }), true);

  const fake = Buffer.from('MZ\u0090\u0000');
  assert.equal(hasValidSignature({ buffer: fake, mimetype: 'application/pdf' }), false);
});

test('имя файла не содержит путей и управляющих символов', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeFileName('отчёт\u0000.pdf'), 'отчёт.pdf');
  assert.equal(sanitizeFileName('   '), 'file');
  assert.equal(sanitizeFileName('x'.repeat(400)).length, 255);
});

// ── Дополнительно: все разрешённые форматы и magic-байты (п. 4.1–4.2) ───────

test('magic-байты проверяются у каждого разрешённого формата', () => {
  const cases: Array<[string, Buffer]> = [
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ['image/png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4)])],
    ['image/gif', Buffer.from('GIF89a....', 'ascii')],
    ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])],
    ['application/pdf', Buffer.from('%PDF-1.7\n', 'ascii')],
    // Office 97–2003 — контейнер OLE2.
    ['application/msword', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ['application/vnd.ms-excel', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    // RTF начинается с {\rtf.
    ['application/rtf', Buffer.from('{\\rtf1\\ansi', 'ascii')],
    // Современные форматы Office и ODT — ZIP-контейнеры.
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
    ],
    ['application/vnd.oasis.opendocument.text', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
    ['application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
  ];

  for (const [mimetype, buffer] of cases) {
    assert.equal(hasValidSignature({ buffer, mimetype }), true, `${mimetype} должен приниматься`);
  }
});

test('подмена типа отклоняется для каждого формата', () => {
  const executable = Buffer.from('MZ\x90\x00', 'binary');
  for (const mimetype of [
    'application/pdf',
    'application/msword',
    'application/rtf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
  ]) {
    assert.equal(hasValidSignature({ buffer: executable, mimetype }), false, `${mimetype} не должен проходить`);
  }
  // Слишком короткий файл не проходит проверку.
  assert.equal(hasValidSignature({ buffer: Buffer.from([0x25]), mimetype: 'application/pdf' }), false);
});

test('неизвестный тип файла не проходит по списку', () => {
  assert.equal(isAllowedUploadMime('application/x-msdownload'), false);
  assert.equal(isAllowedUploadMime('text/html'), false);
  assert.equal(isAllowedUploadMime('image/svg+xml'), false);
  assert.equal(isAllowedUploadMime('application/pdf'), true);
});

test('типы материалов имеют понятные подписи', () => {
  assert.equal(isMaterialType('law_draft'), true);
  assert.equal(isMaterialType('consent_legal_rep'), true);
  assert.equal(isMaterialType('something_else'), false);
  assert.match(materialTypeTitle('law_draft'), /законопроект/i);
  // Неизвестное значение возвращается как есть, а не пустой строкой.
  assert.equal(materialTypeTitle('custom_type'), 'custom_type');
});
