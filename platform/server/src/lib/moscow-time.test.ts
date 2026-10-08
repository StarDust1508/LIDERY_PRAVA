import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addWorkingDays,
  applicationWindowState,
  endOfDayMoscow,
  formatMoscow,
  formatMoscowHuman,
  isDeadlinePassed,
  millisecondsUntil,
  startOfDayMoscow,
} from './moscow-time.js';

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

// ── Дополнительно: окна приёма, сроки и рабочие дни (п. 6.2, 7.5) ───────────

test('окно приёма заявок имеет три состояния', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Приём ещё не открылся.
  assert.equal(
    applicationWindowState(new Date(now + day).toISOString(), new Date(now + 2 * day).toISOString()),
    'before'
  );
  // Приём идёт.
  assert.equal(
    applicationWindowState(new Date(now - day).toISOString(), new Date(now + day).toISOString()),
    'open'
  );
  // Приём закрыт.
  assert.equal(
    applicationWindowState(new Date(now - 2 * day).toISOString(), new Date(now - day).toISOString()),
    'closed'
  );
  // Без дат окно считается открытым: сезон ещё не настроен.
  assert.equal(applicationWindowState(null, null), 'open');
});

test('срок считается пройденным по московскому времени', () => {
  const hour = 60 * 60 * 1000;
  assert.equal(isDeadlinePassed(new Date(Date.now() + hour).toISOString()), false);
  assert.equal(isDeadlinePassed(new Date(Date.now() - hour).toISOString()), true);
  // Без срока ограничения нет.
  assert.equal(isDeadlinePassed(null), false);
  assert.equal(isDeadlinePassed(undefined), false);
});

test('границы московских суток считаются по смещению +3', () => {
  const start = startOfDayMoscow('2026-12-11');
  const end = endOfDayMoscow('2026-12-11');
  // 00:00 МСК 11 декабря = 21:00 UTC 10 декабря; конец суток — 20:59:59.999 UTC.
  assert.equal(start.toISOString(), '2026-12-10T21:00:00.000Z');
  assert.equal(end.toISOString(), '2026-12-11T20:59:59.999Z');
  assert.ok(end.getTime() > start.getTime());

  // Некорректная дата — понятная ошибка, а не «Invalid Date».
  assert.throws(() => startOfDayMoscow('11.12.2026'), /Некорректная дата/);
});

test('остаток времени не уходит в минус', () => {
  const hour = 60 * 60 * 1000;
  const left = millisecondsUntil(new Date(Date.now() + hour).toISOString());
  assert.ok(left > 0 && left <= hour);
  assert.equal(millisecondsUntil(new Date(Date.now() - hour).toISOString()), 0);
  assert.equal(millisecondsUntil(null), 0);
});

test('форматирование даты по МСК устойчиво к сезону', () => {
  // Москва не переходит на летнее время: смещение всегда +3, поэтому 20:00 UTC
  // и зимой, и летом — это 23:00 по МСК.
  assert.match(formatMoscowHuman(new Date('2026-07-01T20:00:00Z')) ?? '', /23:00/);
  assert.match(formatMoscowHuman(new Date('2026-12-01T20:00:00Z')) ?? '', /23:00/);
  // Краткий формат — день.месяц.год; пустое значение даёт null.
  assert.match(formatMoscow(new Date('2026-07-01T20:00:00Z')) ?? '', /01\.07\.2026/);
  assert.equal(formatMoscow(null), null);
});
