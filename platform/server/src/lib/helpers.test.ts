import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from './csv.js';
import { describeAdminPath } from './audit.js';
import { parsePositiveInt, queryString } from './http.js';
import { slugify, uniqueSlug } from './slugify.js';

// Служебные помощники: выгрузка CSV, разбор адресов журнала, разбор параметров,
// адреса страниц. Это места, где ошибка тихо портит данные, поэтому проверяются
// границы: разделители, кавычки, отрицательные числа, пустые значения.

test('CSV: разделитель, кавычки и переводы строк', () => {
  const csv = toCsv(['Имя', 'Комментарий'], [
    ['Приёмов Пётр', 'Материалы полные'],
    ['Кавычки "внутри"', 'Перенос\nстроки'],
    ['Точка;с запятой', ''],
  ]);

  // BOM нужен, чтобы Excel открыл файл в UTF-8.
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.replace('\uFEFF', '').split('\r\n');
  // Все поля в кавычках: так разделитель внутри значения не ломает разбор.
  assert.equal(lines[0], '"Имя";"Комментарий"');
  assert.equal(lines[1], '"Приёмов Пётр";"Материалы полные"');
  // Кавычки удваиваются по правилам CSV.
  assert.equal(lines[2], '"Кавычки ""внутри""";"Перенос\nстроки"');
  assert.equal(lines[3], '"Точка;с запятой";""');
});

test('CSV: числа, null и undefined печатаются предсказуемо', () => {
  const csv = toCsv(['Число', 'Пусто', 'Нет'], [[42, null, undefined]]);
  assert.match(csv, /"42";"";""/);
});

test('адрес журнала разбирается на сущность и объект', () => {
  assert.deepEqual(describeAdminPath('/applications/42'), { entity: 'applications', entityId: '42' });
  assert.deepEqual(describeAdminPath('/teams/7/status'), { entity: 'teams', entityId: '7' });
  // Ключ настройки не число: объект в записи журнала остаётся пустым, а сам
  // ключ сохраняется в теле записи («после»).
  assert.deepEqual(describeAdminPath('/settings/features.mailing'), { entity: 'settings', entityId: null });
  // Адрес без объекта не должен давать пустую сущность.
  assert.equal(describeAdminPath('/').entity, 'unknown');
});

test('разбор параметров запроса: числа только положительные', () => {
  assert.equal(parsePositiveInt('42'), 42);
  assert.equal(parsePositiveInt('0'), null);
  assert.equal(parsePositiveInt('-5'), null);
  assert.equal(parsePositiveInt('4.7'), 4);
  assert.equal(parsePositiveInt('abc'), null);
  assert.equal(parsePositiveInt(undefined), null);
  assert.equal(parsePositiveInt(''), null);
  // Значение в разумных пределах превращается в число.
  assert.equal(parsePositiveInt('1000000'), 1000000);
});

test('разбор строковых параметров: массивы и пустые значения', () => {
  assert.equal(queryString('значение'), 'значение');
  assert.equal(queryString(['первое', 'второе']), 'первое');
  // Пустая строка возвращается как есть: вызывающие проверяют значение на
  // «пусто» через условие, поэтому отдельное приведение к undefined не нужно.
  assert.equal(queryString(''), '');
  assert.equal(queryString(undefined), undefined);
  assert.equal(queryString(42), undefined);
});

test('адрес страницы собирается из русского названия', () => {
  assert.equal(slugify('О цифровых правах граждан'), 'o-cifrovyh-pravah-grazhdan');
  // Спецсимволы и лишние разделители не попадают в адрес.
  const slug = slugify('Законопроект «О защите» — 2027!');
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.ok(!slug.includes('--'));
  assert.ok(!slug.startsWith('-') && !slug.endsWith('-'));
});

test('занятый адрес получает числовой суффикс', async () => {
  const taken = new Set(['rabota', 'rabota-1']);
  const slug = await uniqueSlug('Работа', async (candidate) => taken.has(candidate));
  assert.equal(slug, 'rabota-2');

  const free = await uniqueSlug('Другая работа', async () => false);
  assert.equal(free, 'drugaya-rabota');
});
