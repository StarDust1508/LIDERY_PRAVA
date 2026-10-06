import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addWorkingDays, formatMoscowHuman } from './moscow-time.js';

// Московское время и рабочие дни (ТЗ 08, п. 6.4; п. 7.5 Положения: срок досдачи —
// два рабочих дня).

test('дата печатается с пометкой МСК и неразрывными пробелами', () => {
  assert.equal(formatMoscowHuman(new Date('2026-12-11T20:59:00Z')), '11\u00A0декабря\u00A02026\u00A0года, 23:59\u00A0(МСК)');
});

test('addWorkingDays пропускает выходные', () => {
  // Пятница 11 декабря 2026 + 2 рабочих дня = вторник 15 декабря.
  const friday = new Date('2026-12-11T09:00:00Z');
  const result = addWorkingDays(friday, 2);
  assert.equal(result.getUTCDay(), 2, 'ожидается вторник');
  assert.equal(result.getUTCDate(), 15);
});

test('addWorkingDays с нулём возвращает тот же день', () => {
  const date = new Date('2026-12-14T09:00:00Z');
  assert.equal(addWorkingDays(date, 0).getUTCDate(), 14);
});
