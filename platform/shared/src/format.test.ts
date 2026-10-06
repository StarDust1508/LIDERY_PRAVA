import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFileSize, formatMoscowHuman, formatPhone, formatTimeLeft, plural, pluralize } from './format.js';

// Правила русской типографики и склонения (ТЗ 08, п. 6.4).
// Неразрывный пробел (U+00A0) проверяется явно: именно он не даёт дате, счёту и
// «(МСК)» разрываться по строкам.

test('склонение по числам', () => {
  const forms = ['участник', 'участника', 'участников'];
  assert.equal(plural(1, forms), 'участник');
  assert.equal(plural(2, forms), 'участника');
  assert.equal(plural(4, forms), 'участника');
  assert.equal(plural(5, forms), 'участников');
  assert.equal(plural(11, forms), 'участников');
  assert.equal(plural(21, forms), 'участник');
  assert.equal(plural(102, forms), 'участника');
});

test('число и слово не разрываются переносом', () => {
  assert.equal(pluralize(2, ['участник', 'участника', 'участников']), '2\u00A0участника');
});

test('дата с московским временем', () => {
  assert.match(
    formatMoscowHuman(new Date('2026-12-11T20:59:00Z')),
    /^11\u00A0декабря\u00A02026\u00A0года, 23:59\u00A0\(МСК\)$/
  );
  assert.equal(formatMoscowHuman(null), '—');
  assert.equal(formatMoscowHuman('не дата'), '—');
});

test('размер файла и телефон в едином виде', () => {
  assert.equal(formatFileSize(512), '512\u00A0Б');
  assert.equal(formatFileSize(1024), '1.0\u00A0КБ');
  assert.equal(formatFileSize(25 * 1024 * 1024), '25\u00A0МБ');
  assert.equal(formatFileSize(null), '—');
  assert.equal(formatPhone('+79060747313'), '+7\u00A0906\u00A0074-73-13');
  assert.equal(formatPhone(null), '—');
});

test('остаток срока словами', () => {
  assert.equal(formatTimeLeft(0), 'срок истёк');
  assert.match(formatTimeLeft(5 * 24 * 60 * 60 * 1000), /^осталось\u00A05\u00A0дней$/);
  assert.match(formatTimeLeft(90 * 60 * 1000), /^осталось\u00A01\u00A0час$/);
});
