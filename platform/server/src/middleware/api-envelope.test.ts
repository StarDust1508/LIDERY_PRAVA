import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { apiEnvelope, errorCodeFor, paginationOf, setListMeta } from './api-envelope.js';

// Формат ответов API (ТЗ 05, п. 1.1, 1.2, 1.4).
//
// Обёртка — единственное место, где формируется тело ответа, поэтому проверяется
// напрямую: успех, список с метаданными, ошибка с кодом и перевод 400 → 422.

interface FakeResponse extends Response {
  sent: unknown;
  statusCode: number;
}

function fakeResponse(statusCode = 200): FakeResponse {
  const res = {
    statusCode,
    locals: {} as Record<string, unknown>,
    sent: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set() {
      return res;
    },
    json(payload: unknown) {
      res.sent = payload;
      return res;
    },
  };
  return res as unknown as FakeResponse;
}

function fakeRequest(requestId = 'test-request-id'): Request {
  return { requestId } as unknown as Request;
}

function wrap(res: FakeResponse): void {
  apiEnvelope(fakeRequest(), res as unknown as Response, () => undefined);
}

test('успешный ответ оборачивается в data', () => {
  const res = fakeResponse();
  wrap(res);
  res.json({ status: 'ok', version: '1' });
  assert.deepEqual(res.sent, { data: { status: 'ok', version: '1' } });
});

test('список получает meta с общим числом и страницей', () => {
  const res = fakeResponse();
  wrap(res);
  setListMeta(res, { total: 137, page: 2, perPage: 50 });
  res.json([{ id: 1 }]);
  assert.deepEqual(res.sent, { data: [{ id: 1 }], meta: { total: 137, page: 2, perPage: 50 } });
});

test('обёрнутый ответ не оборачивается повторно', () => {
  const res = fakeResponse();
  wrap(res);
  res.json({ data: [1, 2], meta: { total: 2, page: 1, perPage: 50 } });
  assert.deepEqual(res.sent, { data: [1, 2], meta: { total: 2, page: 1, perPage: 50 } });
});

test('ошибка отдаётся как { error: { code, message } } с requestId', () => {
  const res = fakeResponse(404);
  wrap(res);
  res.json({ error: 'Файл не найден' });
  const sent = res.sent as { error: { code: string; message: string }; requestId: string };
  assert.equal(sent.error.code, 'not_found');
  assert.equal(sent.error.message, 'Файл не найден');
  assert.equal(sent.requestId, 'test-request-id');
});

test('дополнительные поля ответа сохраняются рядом с ошибкой', () => {
  const res = fakeResponse(409);
  wrap(res);
  res.json({ error: 'Срок истёк', application_close_at: '2026-12-11T20:59:00Z' });
  const sent = res.sent as { error: { code: string }; application_close_at: string };
  assert.equal(sent.error.code, 'conflict');
  // Интерфейс показывает дату из этого поля — она должна остаться.
  assert.equal(sent.application_close_at, '2026-12-11T20:59:00Z');
});

test('список подробностей сохраняется при ошибке проверки', () => {
  const res = fakeResponse(422);
  wrap(res);
  res.json({ error: 'Заявка не может быть отправлена', details: ['Нет скана', 'Мало участников'] });
  const sent = res.sent as { error: { code: string; details?: string[] } };
  assert.equal(sent.error.code, 'validation_error');
  assert.deepEqual(sent.error.details, ['Нет скана', 'Мало участников']);
});

test('код 400 превращается в 422, кроме неразобранного запроса', () => {
  const validation = fakeResponse(400);
  wrap(validation);
  validation.json({ error: 'Укажите сезон' });
  assert.equal(validation.statusCode, 422);
  assert.equal((validation.sent as { error: { code: string } }).error.code, 'validation_error');

  const syntax = fakeResponse(400);
  syntax.locals.syntaxError = true;
  wrap(syntax);
  syntax.json({ error: 'Некорректный JSON в теле запроса' });
  assert.equal(syntax.statusCode, 400);
  assert.equal((syntax.sent as { error: { code: string } }).error.code, 'bad_request');
});

test('коды ошибок различают состояния', () => {
  assert.equal(errorCodeFor(400), 'bad_request');
  assert.equal(errorCodeFor(401), 'unauthorized');
  assert.equal(errorCodeFor(403), 'forbidden');
  assert.equal(errorCodeFor(404), 'not_found');
  assert.equal(errorCodeFor(409), 'conflict');
  assert.equal(errorCodeFor(413), 'payload_too_large');
  assert.equal(errorCodeFor(415), 'unsupported_media_type');
  assert.equal(errorCodeFor(422), 'validation_error');
  assert.equal(errorCodeFor(429), 'rate_limited');
  assert.equal(errorCodeFor(500), 'internal_error');
  assert.equal(errorCodeFor(503), 'service_unavailable');
  // Неизвестный код не должен приводить к пустому значению.
  assert.equal(errorCodeFor(418), 'request_error');
  assert.equal(errorCodeFor(599), 'server_error');
});

test('страница и размер страницы считаются по ТЗ', () => {
  const page = paginationOf({ query: { page: '3', perPage: '20' } } as unknown as Request);
  assert.deepEqual(page, { page: 3, perPage: 20, limit: 20, offset: 40 });

  // По умолчанию — 50 записей: столько показывает админка.
  const fallback = paginationOf({ query: {} } as unknown as Request);
  assert.deepEqual(fallback, { page: 1, perPage: 50, limit: 50, offset: 0 });

  // Максимум 200 записей: защита от выгрузки всей базы одной страницей.
  const huge = paginationOf({ query: { perPage: '5000' } } as unknown as Request);
  assert.equal(huge.perPage, 200);

  // Прежние limit/offset продолжают работать.
  const legacy = paginationOf({ query: { limit: '10', offset: '30' } } as unknown as Request);
  assert.deepEqual(legacy, { page: 4, perPage: 10, limit: 10, offset: 30 });

  // Некорректные значения не ломают выдачу.
  const broken = paginationOf({ query: { page: '-5', perPage: 'abc' } } as unknown as Request);
  assert.deepEqual(broken, { page: 1, perPage: 50, limit: 50, offset: 0 });
});
