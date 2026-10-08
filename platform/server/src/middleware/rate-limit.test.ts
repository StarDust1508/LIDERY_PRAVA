import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, scopedRateLimit } from './rate-limit.js';

// Ограничение частоты запросов (ТЗ 11, п. 5.4).
//
// Проверяется поведение, от которого зависит защита от перебора: лимит в окне,
// заголовок Retry-After, вызов обработчика при отказе и лимит по своему ключу
// (например, «три выдачи ссылки в час на команду»).

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status(code: number): FakeResponse;
  set(name: string, value: string): FakeResponse;
  json(payload: unknown): FakeResponse;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function fakeRequest(ip: string, extra: Record<string, unknown> = {}): Request {
  return {
    ip,
    method: 'POST',
    path: '/test',
    baseUrl: '/api',
    route: { path: '/test' },
    headers: {},
    socket: { remoteAddress: ip },
    ...extra,
  } as unknown as Request;
}

/** Прогоняет запрос через middleware и сообщает, пропущен ли он дальше. */
function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
  res: FakeResponse
): boolean {
  let passed = false;
  middleware(req, res as unknown as Response, () => {
    passed = true;
  });
  return passed;
}

test('запросы сверх лимита отклоняются с Retry-After', () => {
  const middleware = rateLimit(3, 60_000);
  const ip = '10.0.0.1';

  for (let index = 0; index < 3; index += 1) {
    const res = fakeResponse();
    assert.equal(run(middleware, fakeRequest(ip), res), true, `запрос ${index + 1} должен пройти`);
  }

  const blocked = fakeResponse();
  assert.equal(run(middleware, fakeRequest(ip), blocked), false);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.match(String((blocked.body as { error: string }).error), /Слишком много запросов/);
});

test('лимит считается отдельно для каждого адреса', () => {
  const middleware = rateLimit(1, 60_000);
  assert.equal(run(middleware, fakeRequest('10.0.0.2'), fakeResponse()), true);
  // Другой адрес не должен пострадать от чужого лимита.
  assert.equal(run(middleware, fakeRequest('10.0.0.3'), fakeResponse()), true);
  assert.equal(run(middleware, fakeRequest('10.0.0.2'), fakeResponse()), false);
});

test('обработчик отказа вызывается: попытки попадают в журнал', () => {
  const seen: string[] = [];
  const middleware = rateLimit(1, 60_000, (req) => {
    seen.push(String(req.ip));
  });
  run(middleware, fakeRequest('10.0.0.4'), fakeResponse());
  run(middleware, fakeRequest('10.0.0.4'), fakeResponse());
  assert.deepEqual(seen, ['10.0.0.4']);
});

test('ошибка обработчика отказа не меняет ответ клиенту', () => {
  const middleware = rateLimit(1, 60_000, () => {
    throw new Error('сбой журнала');
  });
  run(middleware, fakeRequest('10.0.0.5'), fakeResponse());
  const blocked = fakeResponse();
  assert.equal(run(middleware, fakeRequest('10.0.0.5'), blocked), false);
  assert.equal(blocked.statusCode, 429);
});

test('лимит по своему ключу считает запросы на команду, а не на адрес', () => {
  // «Ссылку доступа можно запрашивать не чаще 3 раз в час на команду».
  const middleware = scopedRateLimit(2, 3_600_000, (req) => {
    const teamId = String((req as unknown as { params: { id: string } }).params.id);
    return `team:${teamId}`;
  });

  const teamRequest = (id: string, ip: string) => fakeRequest(ip, { params: { id } });

  assert.equal(run(middleware, teamRequest('7', '10.0.0.6'), fakeResponse()), true);
  // Другой адрес, та же команда — лимит общий.
  assert.equal(run(middleware, teamRequest('7', '10.0.0.7'), fakeResponse()), true);
  const blocked = fakeResponse();
  assert.equal(run(middleware, teamRequest('7', '10.0.0.8'), blocked), false);
  assert.equal(blocked.statusCode, 429);
  assert.match(String((blocked.body as { error: string }).error), /не чаще 2 раз в час/);

  // Другая команда лимитом не ограничена.
  assert.equal(run(middleware, teamRequest('8', '10.0.0.6'), fakeResponse()), true);
});

test('без ключа лимит не применяется: маршрут сам ответит об ошибке', () => {
  const middleware = scopedRateLimit(1, 60_000, () => null);
  assert.equal(run(middleware, fakeRequest('10.0.0.9'), fakeResponse()), true);
  assert.equal(run(middleware, fakeRequest('10.0.0.9'), fakeResponse()), true);
});
