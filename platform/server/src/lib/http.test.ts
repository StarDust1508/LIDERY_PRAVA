import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from './http.js';

// Маршруты Express 4 не умеют перехватывать отклонённые промисы: без обёртки
// ошибка в асинхронном обработчике остаётся необработанным отказом, запрос
// висит до таймаута, а в журнал ничего не попадает. Проверяем, что обёртка
// действительно передаёт ошибку в error-handler.

const req = {} as Request;
const res = {} as Response;

test('успешный обработчик не трогает next', async () => {
  let nextCalls = 0;
  let handled = false;
  const handler = asyncHandler(async () => {
    handled = true;
  });

  handler(req, res, (() => {
    nextCalls += 1;
  }) as NextFunction);

  // Обработчик асинхронный: даём микрозадачам выполниться.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handled, true);
  assert.equal(nextCalls, 0);
});

test('ошибка асинхронного обработчика уходит в next', async () => {
  const failure = new Error('База недоступна');
  const handler = asyncHandler(async () => {
    throw failure;
  });

  let received: unknown = null;
  handler(req, res, ((error: unknown) => {
    received = error;
  }) as NextFunction);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, failure, 'в next должна попасть та же ошибка');
});

test('синхронное исключение внутри обработчика тоже перехватывается', async () => {
  const handler = asyncHandler(async () => {
    JSON.parse('{не json}');
  });

  let received: unknown = null;
  handler(req, res, ((error: unknown) => {
    received = error;
  }) as NextFunction);

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(received instanceof SyntaxError, `ожидалась SyntaxError, получено: ${String(received)}`);
});

test('значение отказа не обязательно ошибка и передаётся как есть', async () => {
  const handler = asyncHandler(() => Promise.reject('строка вместо ошибки'));

  let received: unknown = null;
  handler(req, res, ((error: unknown) => {
    received = error;
  }) as NextFunction);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, 'строка вместо ошибки');
});

test('обёртка возвращает обработчик, пригодный для express', () => {
  const handler = asyncHandler(async () => undefined);
  assert.equal(typeof handler, 'function');
  assert.equal(handler.length, 3, 'обработчик принимает req, res и next');
});
