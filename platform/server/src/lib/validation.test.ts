import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmail, isAllowedMaterialUrl, normalizeEmail, requiredText } from './validation.js';

// Ссылки на материалы: только российские сервисы (п. 14.4 Положения).

test('почта нормализуется и проверяется', () => {
  assert.equal(normalizeEmail('  Captain@Example.RU '), 'captain@example.ru');
  assert.equal(isEmail('captain@example.ru'), true);
  assert.equal(isEmail('captain@example'), false);
  assert.equal(isEmail('не-почта'), false);
});

test('ссылки на зарубежные облака отклоняются', () => {
  for (const url of [
    'https://drive.google.com/file/d/abc',
    'https://dropbox.com/s/abc',
    'https://youtube.com/watch?v=abc',
    'http://vk.com/video-1_2',
  ]) {
    assert.equal(isAllowedMaterialUrl(url), false, `${url} должен быть отклонён`);
  }
});

test('ссылки на российские сервисы принимаются', () => {
  for (const url of [
    'https://vk.com/video-1_2',
    'https://vk.ru/video-1_2',
    'https://disk.yandex.ru/i/abc',
    'https://cloud.mail.ru/public/abc',
    'https://rutube.ru/video/abc',
  ]) {
    assert.equal(isAllowedMaterialUrl(url), true, `${url} должен быть принят`);
  }
});

test('requiredText обрезает пробелы, отсекает пустое и режет по пределу длины', () => {
  assert.equal(requiredText('  текст  ', 100), 'текст');
  // Пустое и не-строка — это отсутствие значения, а не пустая строка.
  assert.equal(requiredText('   ', 100), null);
  assert.equal(requiredText(123, 100), null);
  assert.equal(requiredText(null, 100), null);
  // Длинное значение обрезается до предела: ограничение задаётся полем ввода,
  // а сервер не должен отклонять запрос из-за лишнего символа.
  assert.equal(requiredText('x'.repeat(101), 100)?.length, 100);
});
