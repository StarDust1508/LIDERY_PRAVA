import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ApiError, api, expertApi, requestWithMeta } from './api.js';

// Проверки клиента API (ТЗ 05): разворачивание обёртки `{ data, meta }`,
// превращение ошибки в ApiError и заголовки запроса.
//
// Сеть не нужна: подменяем globalThis.fetch и смотрим, что именно уходит на
// сервер и что возвращается вызывающему коду.

interface Captured {
  path: string;
  init: RequestInit;
}

const originalFetch = globalThis.fetch;
let calls: Captured[] = [];

function mockFetch(
  responder: (captured: Captured) => { status?: number; ok?: boolean; body?: string } | Promise<never>
): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const captured = { path: String(input), init };
    calls.push(captured);
    const answer = await responder(captured);
    const status = answer.status ?? 200;
    return {
      ok: answer.ok ?? (status >= 200 && status < 300),
      status,
      text: async () => answer.body ?? '',
    } as unknown as Response;
  }) as typeof fetch;
}

function json(body: unknown, status = 200): { status: number; body: string } {
  return { status, body: JSON.stringify(body) };
}

after(() => {
  globalThis.fetch = originalFetch;
});

test('обёртка { data } снимается, полезная нагрузка отдаётся как есть', async () => {
  mockFetch(() => json({ data: [{ id: 1, title: 'Направление' }] }));
  const directions = await api.directions();
  assert.deepEqual(directions, [{ id: 1, title: 'Направление' }]);
});

test('ответ без обёртки тоже принимается (совместимость со старой сборкой)', async () => {
  mockFetch(() => json([{ id: 2 }]));
  assert.deepEqual(await api.winners(), [{ id: 2 }]);
});

test('объект с посторонними полями не разворачивается', async () => {
  // Если сервер вернул не обёртку, а данные с полем data внутри, снимать
  // «обёртку» нельзя — иначе часть ответа потерялась бы.
  mockFetch(() => json({ data: { nested: true }, total: 5 }));
  assert.deepEqual(await api.cabinetSession(), { data: { nested: true }, total: 5 });
});

test('requestWithMeta возвращает данные и метаданные страницы', async () => {
  mockFetch(() => json({ data: [{ team_id: 1 }], meta: { total: 42, page: 2, perPage: 20 } }));
  const result = await requestWithMeta('/api/iniciatives');
  assert.deepEqual(result.data, [{ team_id: 1 }]);
  assert.deepEqual(result.meta, { total: 42, page: 2, perPage: 20 });
});

test('requestWithMeta без метаданных возвращает null, а не ошибку', async () => {
  mockFetch(() => json({ data: [] }));
  const result = await requestWithMeta('/api/expert/assignments');
  assert.deepEqual(result.data, []);
  assert.equal(result.meta, null);
});

test('ошибка в формате ТЗ 05 превращается в ApiError с деталями', async () => {
  mockFetch(() =>
    json(
      {
        error: {
          code: 'validation_error',
          message: 'Заявка не прошла проверку',
          details: ['Нужно от 2 до 4 участников', 'Не выбран капитан'],
          requestId: 'req-1',
        },
      },
      422
    )
  );

  await assert.rejects(
    () => api.cabinetSubmit({} as never),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.ok(error instanceof Error, 'ApiError должен быть обычной ошибкой JS');
      assert.equal(error.name, 'ApiError');
      assert.equal(error.status, 422);
      assert.equal(error.message, 'Заявка не прошла проверку');
      assert.deepEqual(error.details, ['Нужно от 2 до 4 участников', 'Не выбран капитан']);
      return true;
    }
  );
});

test('старый вид ошибки ({ error: "текст" }) продолжает читаться', async () => {
  mockFetch(() => json({ error: 'Доступ запрещён' }, 403));
  await assert.rejects(
    () => api.cabinetTeam(),
    (error: unknown) => {
      const apiError = error as ApiError;
      assert.equal(apiError.status, 403);
      assert.equal(apiError.message, 'Доступ запрещён');
      assert.deepEqual(apiError.details, []);
      return true;
    }
  );
});

test('детали ошибки берутся и из корня ответа, и приводятся к строкам', async () => {
  mockFetch(() => json({ error: { message: 'Ошибка' }, details: [1, 'второе'] }, 400));
  await assert.rejects(
    () => api.directions(),
    (error: unknown) => {
      assert.deepEqual((error as ApiError).details, ['1', 'второе']);
      return true;
    }
  );
});

test('неизвестное тело ошибки даёт понятное сообщение по умолчанию', async () => {
  mockFetch(() => ({ status: 500, body: '<html>502 Bad Gateway</html>' }));
  await assert.rejects(
    () => api.partners(),
    (error: unknown) => {
      const apiError = error as ApiError;
      assert.equal(apiError.status, 500);
      assert.equal(apiError.message, 'Не удалось выполнить запрос.');
      assert.deepEqual(apiError.details, []);
      return true;
    }
  );
});

test('пустое тело успешного ответа не считается ошибкой', async () => {
  mockFetch(() => ({ status: 204, body: '' }));
  assert.deepEqual(await api.cabinetLogout(), {});
});

test('недоступный сервер и таймаут различаются по сообщению', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(
    () => api.season(),
    (error: unknown) => {
      const apiError = error as ApiError;
      assert.equal(apiError.status, 0);
      assert.match(apiError.message, /недоступен/i);
      return true;
    }
  );

  globalThis.fetch = (async () => {
    const abort = new Error('Превышено время ожидания');
    abort.name = 'AbortError';
    throw abort;
  }) as typeof fetch;
  await assert.rejects(
    () => api.season(),
    (error: unknown) => {
      const apiError = error as ApiError;
      assert.equal(apiError.status, 0);
      assert.match(apiError.message, /слишком долго/i);
      return true;
    }
  );
});

test('каждый запрос идёт с cookie сессии и ожидает JSON', async () => {
  mockFetch(() => json({ data: {} }));
  await api.season();
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.path, '/api/season/current');
  assert.equal(call.init.credentials, 'include');
  assert.equal((call.init.headers as Record<string, string>).Accept, 'application/json');
});

test('тело JSON отправляется как JSON, форма — без Content-Type', async () => {
  mockFetch(() => json({ data: {} }));
  await api.createLead({ name: 'Иван', email: 'ivan@example.test', message: 'Вопрос' } as never);
  const jsonCall = calls.at(-1)!;
  assert.equal(jsonCall.init.method, 'POST');
  const jsonHeaders = jsonCall.init.headers as Record<string, string>;
  assert.equal(jsonHeaders['Content-Type'], 'application/json');
  assert.equal(typeof jsonCall.init.body, 'string');

  mockFetch(() => json({ data: {} }));
  const form = new FormData();
  form.set('file', new Blob(['скан']), 'scan.pdf');
  await api.cabinetUploadMaterial(form);
  const formCall = calls.at(-1)!;
  const formHeaders = formCall.init.headers as Record<string, string>;
  // Content-Type формы ставит браузер: со своим значением теряется boundary.
  assert.equal(formHeaders['Content-Type'], undefined);
  assert.equal(formCall.init.body, form);
});

test('токен доступа добавляется заголовком только там, где он передан', async () => {
  mockFetch(() => json({ data: {} }));
  await api.cabinetMaterials('access-token-1');
  assert.equal((calls.at(-1)!.init.headers as Record<string, string>).Authorization, 'Bearer access-token-1');

  mockFetch(() => json({ data: {} }));
  await api.cabinetMaterials();
  assert.equal((calls.at(-1)!.init.headers as Record<string, string>).Authorization, undefined);
});

test('ключ идемпотентности заявки уходит в отдельном заголовке', async () => {
  mockFetch(() => json({ data: { public_number: 'ЛП-2027-000001' } }));
  await api.createApplication({} as never, 'idem-key-123');
  const headers = calls.at(-1)!.init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], 'idem-key-123');
});

test('пустые параметры списка не попадают в строку запроса', async () => {
  mockFetch(() => json({ data: [] }));
  await api.initiatives({ year: 2027, direction_id: undefined, q: '' });
  assert.equal(calls.at(-1)!.path, '/api/initiatives?year=2027');

  mockFetch(() => json({ data: [] }));
  await api.masterclasses({ status: 'past' });
  assert.equal(calls.at(-1)!.path, '/api/masterclasses?status=past');

  mockFetch(() => json({ data: [] }));
  await api.masterclasses();
  assert.equal(calls.at(-1)!.path, '/api/masterclasses');
});

test('параметры в пути кодируются, а не подставляются как есть', async () => {
  mockFetch(() => json({ data: {} }));
  await api.initiative('закон/о & праве');
  assert.equal(calls.at(-1)!.path, '/api/initiatives/%D0%B7%D0%B0%D0%BA%D0%BE%D0%BD%2F%D0%BE%20%26%20%D0%BF%D1%80%D0%B0%D0%B2%D0%B5');

  mockFetch(() => json({ data: {} }));
  await api.applicationStatus('ЛП 001');
  assert.equal(calls.at(-1)!.path, '/api/applications/status/%D0%9B%D0%9F%20001');
});

test('контур эксперта обращается к своим адресам', async () => {
  mockFetch(() => json({ data: { authenticated: false } }));
  await expertApi.session();
  assert.equal(calls.at(-1)!.path, '/api/expert/session');

  mockFetch(() => json({ data: { success: true } }));
  await expertApi.accessByToken('token-from-letter');
  const call = calls.at(-1)!;
  assert.equal(call.path, '/api/expert/access');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(call.init.body)), { token: 'token-from-letter' });
});
