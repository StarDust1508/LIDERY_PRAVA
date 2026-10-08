import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { csrfProtection } from './csrf.js';
import { requestContext, requestIdOf } from './request-context.js';

// Защита изменяющих запросов (ТЗ 11, п. 5.3) и идентификатор запроса (п. 5.9).

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

function fakeRequest(
  method: string,
  headers: Record<string, string> = {},
  requestId?: string
): Request {
  return {
    method,
    headers,
    ...(requestId === undefined ? {} : { requestId }),
  } as unknown as Request;
}

function passed(middleware: (req: Request, res: Response, next: NextFunction) => void, req: Request, res: FakeResponse): boolean {
  let ok = false;
  middleware(req, res as unknown as Response, () => {
    ok = true;
  });
  return ok;
}

test('безопасные методы проверку источника не проходят', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(passed(csrfProtection, fakeRequest(method, { origin: 'https://evil.example' }), fakeResponse()), true);
  }
});

test('запрос с Bearer-токеном не считается межсайтовым', () => {
  const req = fakeRequest('POST', { authorization: 'Bearer token', origin: 'https://evil.example' });
  assert.equal(passed(csrfProtection, req, fakeResponse()), true);
});

test('межсайтовый изменяющий запрос отклоняется', () => {
  const res = fakeResponse();
  const req = fakeRequest('POST', { origin: 'https://evil.example' });
  assert.equal(passed(csrfProtection, req, res), false);
  assert.equal(res.statusCode, 403);
  assert.match(String((res.body as { error: string }).error), /источник не входит/);
});

test('явный признак межсайтового запроса отклоняется', () => {
  const res = fakeResponse();
  const req = fakeRequest('PATCH', { 'sec-fetch-site': 'cross-site' });
  assert.equal(passed(csrfProtection, req, res), false);
  assert.equal(res.statusCode, 403);
  assert.match(String((res.body as { error: string }).error), /межсайтовые/);
});

test('источник из белого списка пропускается', () => {
  const req = fakeRequest('POST', { origin: 'https://lideryprava.test' });
  assert.equal(passed(csrfProtection, req, fakeResponse()), true);
});

test('локальный источник допускается в разработке', () => {
  // В боевом режиме правило не действует: там только белый список.
  const req = fakeRequest('POST', { origin: 'http://127.0.0.1:4173' });
  assert.equal(passed(csrfProtection, req, fakeResponse()), true);
});

test('referer проверяется, если Origin отсутствует', () => {
  const req = fakeRequest('POST', { referer: 'https://evil.example/page' });
  assert.equal(passed(csrfProtection, req, fakeResponse()), false);
});

test('запрос без заголовков источника не блокируется: это не браузер', () => {
  // Так работают приёмочный прогон и systemd-таймеры: cookie им никто не выдавал.
  assert.equal(passed(csrfProtection, fakeRequest('POST'), fakeResponse()), true);
});

test('идентификатор запроса возвращается в ответе', () => {
  const res = fakeResponse();
  const req = fakeRequest('GET');
  let nextCalled = false;
  requestContext(req, res as unknown as Response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  const id = res.headers['X-Request-Id'];
  assert.ok(id && id.length >= 8);
  // Тот же идентификатор доступен обработчику.
  assert.equal(requestIdOf(req), id);
});

test('чужой идентификатор принимается только безопасной формы', () => {
  const res = fakeResponse();
  const incoming = 'abc-123_DEF.456';
  const req = fakeRequest('GET', { 'x-request-id': incoming });
  requestContext(req, res as unknown as Response, () => undefined);
  assert.equal(res.headers['X-Request-Id'], incoming);

  // Опасные символы вырезаются, слишком короткое значение заменяется своим.
  const dirty = fakeResponse();
  const dirtyReq = fakeRequest('GET', { 'x-request-id': '<script>alert(1)</script>' });
  requestContext(dirtyReq, dirty as unknown as Response, () => undefined);
  assert.ok(!String(dirty.headers['X-Request-Id']).includes('<'));

  const short = fakeResponse();
  requestContext(fakeRequest('GET', { 'x-request-id': 'abc' }), short as unknown as Response, () => undefined);
  assert.notEqual(short.headers['X-Request-Id'], 'abc');
});
