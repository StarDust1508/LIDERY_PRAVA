import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import type { Request } from 'express';
import {
  adminAuditActor,
  adminStablePrincipal,
  adminUserIdOf,
  bearerToken,
  clientIpOf,
  loginBlockedFor,
  recordLoginFail,
  tokenHash,
  verifyAdminCredentials,
  verifyTokenSignature,
} from './admin-auth.js';
import { ADMIN_LOGIN, ADMIN_LOGIN_FAIL_MAX, ADMIN_PASSWORD, ADMIN_SESSION_SECRET } from '../config.js';

// Проверки входа в админ-панель (ТЗ 07 п. 1.3, 149-ФЗ ст. 16): подпись и срок
// жизни сессии, блокировка по IP после серии неудач, проверка учётных данных.
//
// Блокировка живёт в памяти процесса и общая для всех тестов файла, поэтому
// каждый сценарий работает со своим синтетическим IP.

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function bearer(value: string): Request {
  return fakeRequest({ headers: { authorization: `Bearer ${value}` } });
}

test('bearer-токен извлекается из заголовка Authorization', () => {
  assert.equal(bearerToken(bearer('v3.abc.def')), 'v3.abc.def');
  // Чужие схемы авторизации не принимаются: админ-панель работает только с Bearer.
  assert.equal(bearerToken(bearer('Basic xyz')), undefined);
  assert.equal(bearerToken(fakeRequest()), undefined);
  // Заголовок разбирается строго: лишние пробелы и одинокое слово — не токен.
  assert.equal(bearerToken(bearer('  v3.abc.def  ')), undefined);
  assert.equal(bearerToken(fakeRequest({ headers: { authorization: '' } })), undefined);
  assert.equal(bearerToken(fakeRequest({ headers: { authorization: 'Bearer' } })), undefined);
  assert.equal(bearerToken(fakeRequest({ headers: { authorization: 'Bearer a b' } })), undefined);
});

test('IP клиента берётся из req.ip, иначе из сокета, и не длиннее 64 символов', () => {
  assert.equal(clientIpOf(fakeRequest({ ip: '192.0.2.10' })), '192.0.2.10');
  assert.equal(
    clientIpOf(fakeRequest({ ip: undefined, socket: { remoteAddress: '::1' } } as Partial<Request>)),
    '::1'
  );
  assert.equal(clientIpOf(fakeRequest({ ip: undefined, socket: {} } as Partial<Request>)), 'unknown');
  assert.equal(clientIpOf(fakeRequest({ ip: 'x'.repeat(200) })).length, 64);
});

test('хэш токена сессии однозначен и не восстановим', () => {
  const a = tokenHash('session-token-a');
  assert.equal(a, tokenHash('session-token-a'));
  assert.notEqual(a, tokenHash('session-token-b'));
  assert.match(a, /^[a-f0-9]{64}$/);
  // В хранилище попадает хэш, а не сам токен.
  assert.ok(!a.includes('session-token-a'));
});

// Токен собирается ровно так же, как его выпускает сервер, чтобы проверять
// поведение проверки подписи, а не собственную выдумку о формате.
function signSession(payload: Record<string, unknown>, secret = ADMIN_SESSION_SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `v3.${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function sessionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const iat = Date.now();
  return {
    aud: 'liders-admin',
    iat,
    exp: iat + 3_600_000,
    jti: 'jti-abcdefghijklmnop',
    principal: { kind: 'env' },
    ...overrides,
  };
}

test('сессия без токена и с повреждённой подписью не проходит', () => {
  assert.equal(verifyTokenSignature(undefined), null);
  assert.equal(verifyTokenSignature(''), null);
  assert.equal(verifyTokenSignature('не-токен'), null);
  // Формат версии обязателен: две части, четыре части и чужая версия отклоняются.
  assert.equal(verifyTokenSignature('abc.def'), null);
  assert.equal(verifyTokenSignature('v3.abc.def.ghi'), null);
  assert.equal(verifyTokenSignature('v2.abc.def'), null);
  // Верная структура, но подпись не сходится.
  assert.equal(verifyTokenSignature(signSession({ jti: 'x' }, 'чужой-секрет-достаточной-длины!!')), null);
});

test('подписанная сессия читается, а подделанное содержимое — нет', () => {
  const token = signSession(sessionPayload());
  const payload = verifyTokenSignature(token);
  assert.ok(payload);
  assert.equal(payload?.jti, 'jti-abcdefghijklmnop');
  assert.deepEqual(payload?.principal, { kind: 'env' });

  // Подменяем тело токена, оставляя прежнюю подпись, — проверка обязана упасть.
  const [, , signature] = token.split('.');
  const tampered = Buffer.from(
    JSON.stringify(sessionPayload({ principal: { kind: 'user', userId: 1, authVersion: 1 }, role: 'admin' }))
  ).toString('base64url');
  assert.equal(verifyTokenSignature(`v3.${tampered}.${signature}`), null);
});

test('срок жизни сессии и её поля проверяются строго', () => {
  const now = Date.now();
  // Просроченная сессия не принимается.
  assert.equal(
    verifyTokenSignature(signSession(sessionPayload({ exp: now - 1000, iat: now - 3_600_000 }))),
    null
  );
  // Сессия с выдуманным будущим началом (сдвиг часов вперёд) отклоняется.
  assert.equal(
    verifyTokenSignature(signSession(sessionPayload({ iat: now + 10 * 60_000, exp: now + 20 * 60_000 }))),
    null
  );
  // Срок больше суток — нарушение политики.
  assert.equal(verifyTokenSignature(signSession(sessionPayload({ exp: now + 48 * 3_600_000 }))), null);
  // Слишком короткий идентификатор сессии не принимается: журнал должен быть уникальным.
  assert.equal(verifyTokenSignature(signSession(sessionPayload({ jti: 'short' }))), null);
  // Чужая аудитория — токен от другого приложения.
  assert.equal(verifyTokenSignature(signSession(sessionPayload({ aud: 'liders-public' }))), null);
  // Учётная запись обязана нести версию аутентификации (сброс сессий при смене пароля).
  assert.equal(
    verifyTokenSignature(signSession(sessionPayload({ principal: { kind: 'user', userId: 7 } }))),
    null
  );

  const alive = verifyTokenSignature(
    signSession(sessionPayload({ principal: { kind: 'user', userId: 7, authVersion: 3, role: 'operator' } }))
  );
  assert.ok(alive);
  assert.deepEqual(alive?.principal, { kind: 'user', userId: 7, authVersion: 3, role: 'operator' });
});

test('личность администратора для аудита различает env-вход и учётную запись', () => {
  const envUser = bearer(signSession(sessionPayload({ jti: 'jti-audit-1234567890' })));
  assert.equal(adminStablePrincipal(envUser), 'env:owner');
  assert.equal(adminUserIdOf(envUser), null);
  assert.match(adminAuditActor(envUser), /^admin-session:jti-audit-12/);

  const accountUser = bearer(
    signSession(
      sessionPayload({
        jti: 'jti-audit-0987654321',
        principal: { kind: 'user', userId: 42, authVersion: 1 },
      })
    )
  );
  assert.equal(adminStablePrincipal(accountUser), 'user:42');
  assert.equal(adminUserIdOf(accountUser), 42);

  // Без токена — «неизвестный» актор, а не падение.
  assert.equal(adminStablePrincipal(fakeRequest()), null);
  assert.equal(adminUserIdOf(fakeRequest()), null);
  assert.equal(adminAuditActor(fakeRequest()), 'admin-session:unknown');
});

test('блокировка по IP включается только после серии неудач', () => {
  const ip = '198.51.100.11';
  assert.equal(loginBlockedFor(ip), 0);

  // Первые неудачи не блокируют вход — иначе одна опечатка закрыла бы доступ.
  for (let attempt = 1; attempt < ADMIN_LOGIN_FAIL_MAX; attempt += 1) {
    recordLoginFail(ip);
    assert.equal(loginBlockedFor(ip), 0, `после ${attempt} неудач блокировки быть не должно`);
  }
  // Последняя разрешённая неудача включает блокировку на настроенный срок.
  recordLoginFail(ip);
  const seconds = loginBlockedFor(ip);
  assert.ok(seconds > 0, 'после лимита неудач IP должен быть заблокирован');
  assert.ok(seconds <= 24 * 3600, 'срок блокировки не должен превышать сутки');
});

test('блокировка считается отдельно для каждого IP', () => {
  const blocked = '198.51.100.21';
  for (let attempt = 0; attempt < ADMIN_LOGIN_FAIL_MAX; attempt += 1) recordLoginFail(blocked);
  assert.ok(loginBlockedFor(blocked) > 0);
  assert.equal(loginBlockedFor('198.51.100.22'), 0);
});

test('учётные данные из окружения проверяются строго', async () => {
  if (!ADMIN_LOGIN) {
    assert.equal(await verifyAdminCredentials('', ADMIN_PASSWORD), true);
    assert.equal(await verifyAdminCredentials('', 'неверный-пароль'), false);
    // При незаданном ADMIN_LOGIN непустой логин уходит в базу и там не находится.
    assert.equal(await verifyAdminCredentials('nobody@example.test', ADMIN_PASSWORD), false);
  } else {
    assert.equal(await verifyAdminCredentials(ADMIN_LOGIN, ADMIN_PASSWORD), true);
    assert.equal(await verifyAdminCredentials(` ${ADMIN_LOGIN} `, ADMIN_PASSWORD), true, 'логин обрезается');
    assert.equal(await verifyAdminCredentials(ADMIN_LOGIN, 'неверный-пароль'), false);
    assert.equal(await verifyAdminCredentials('другой', ADMIN_PASSWORD), false);
  }
});

test('пустой пароль и нестроковые значения не пускаются', async () => {
  assert.equal(await verifyAdminCredentials(ADMIN_LOGIN, ''), false);
  assert.equal(await verifyAdminCredentials(ADMIN_LOGIN, undefined), false);
  assert.equal(await verifyAdminCredentials(ADMIN_LOGIN, 12345), false);
  assert.equal(await verifyAdminCredentials(undefined, undefined), false);
});
