import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DENIED_UPLOAD_EXTENSIONS,
  checkUploadExtension,
  fileExtension,
  hasValidSignature,
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
