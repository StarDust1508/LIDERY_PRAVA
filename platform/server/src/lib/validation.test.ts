import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ageOn,
  isActLevel,
  isAllowedMaterialUrl,
  isEmail,
  isIsoDate,
  isParticipantCategory,
  isPhone,
  isValidExternalUrl,
  normalizeEmail,
  requiredText,
} from './validation.js';

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

// ── Дополнительно: границы значений (п. 4.3 Положения, ТЗ 11, п. 5.7) ───────

test('возраст считается на дату окончания приёма', () => {
  const closeAt = new Date('2026-12-11T20:59:00Z');
  // День рождения ещё не наступил — возраст на год меньше.
  assert.equal(ageOn('2008-12-12', closeAt), 17);
  // День рождения совпадает с датой окончания приёма — участнику 18.
  assert.equal(ageOn('2008-12-11', closeAt), 18);
  // Нижняя и верхняя границы диапазона (16 и 35 лет).
  assert.equal(ageOn('2010-12-11', closeAt), 16);
  assert.equal(ageOn('1990-12-11', closeAt), 36);
  assert.equal(ageOn('1991-12-11', closeAt), 35);
});

test('категории участников и уровни акта принимаются только известные', () => {
  assert.equal(isParticipantCategory('student'), true);
  assert.equal(isParticipantCategory('young_specialist'), true);
  assert.equal(isParticipantCategory('школьник'), false);
  assert.equal(isParticipantCategory(null), false);

  assert.equal(isActLevel('federal'), true);
  assert.equal(isActLevel('regional'), true);
  assert.equal(isActLevel('местный'), false);
});

test('телефон проверяется по российскому формату', () => {
  assert.equal(isPhone('+7 906 074-73-13'), true);
  assert.equal(isPhone('8 (966) 789-76-05'), true);
  assert.equal(isPhone('+7 906 074 73 13'), true);
  assert.equal(isPhone('906'), false);
  assert.equal(isPhone('позвоните мне'), false);
  assert.equal(isPhone(null), false);
});

test('внешние ссылки: только https и только российские сервисы', () => {
  assert.equal(isValidExternalUrl('https://example.ru/file'), true);
  // Протокол http и файловые схемы отклоняются (ТЗ 11, п. 5.7).
  assert.equal(isValidExternalUrl('http://example.ru/file'), false);
  assert.equal(isValidExternalUrl('ftp://example.ru/file'), false);
  assert.equal(isValidExternalUrl('javascript:alert(1)'), false);
  assert.equal(isValidExternalUrl('не ссылка'), false);

  // Поддомены разрешённых сервисов принимаются, похожие домены — нет.
  assert.equal(isAllowedMaterialUrl('https://m.vk.com/video-1_2'), true);
  assert.equal(isAllowedMaterialUrl('https://disk.yandex.ru/i/abc'), true);
  assert.equal(isAllowedMaterialUrl('https://vk.com.evil.example/video'), false);
  assert.equal(isAllowedMaterialUrl('https://notvk.com/video'), false);
});

test('дата проверяется строго в формате ГГГГ-ММ-ДД', () => {
  assert.equal(isIsoDate('2026-12-11'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('11.12.2026'), false);
  assert.equal(isIsoDate('2026-12-11T00:00:00Z'), false);
});
