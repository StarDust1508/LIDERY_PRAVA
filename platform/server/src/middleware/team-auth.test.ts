import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { generateAccessToken, hashAccessToken, teamTokenFromRequest } from './team-auth.js';

// Доступ команды в кабинет (ТЗ 06, п. 7.5): токен показывается один раз, в базе
// лежит только его хэш, а сам токен приходит либо заголовком Authorization, либо
// отдельным заголовком X-Team-Token.

function fakeRequest(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

test('токен доступа генерируется случайным и URL-безопасным', () => {
  const token = generateAccessToken();
  // 32 байта в base64url — 43 символа; короче быть не должно.
  assert.ok(token.length >= 43, `слишком короткий токен: ${token.length} символов`);
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'в токене допустимы только URL-безопасные символы');
  assert.ok(!token.includes('='), 'добивающие знаки «=» в токене не нужны');
});

test('два вызова дают разные токены', () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index += 1) seen.add(generateAccessToken());
  assert.equal(seen.size, 200, 'токены не должны повторяться');
});

test('в базе хранится хэш токена, а не сам токен', () => {
  const token = generateAccessToken();
  const hash = hashAccessToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(hash, hashAccessToken(token), 'хэш должен быть воспроизводимым');
  assert.ok(!hash.includes(token), 'хэш не должен содержать исходный токен');
  assert.notEqual(hash, hashAccessToken(generateAccessToken()));
});

test('токен читается из заголовка Authorization', () => {
  assert.equal(teamTokenFromRequest(fakeRequest({ authorization: 'Bearer team-token-1' })), 'team-token-1');
  // Чужие схемы и лишние пробелы не принимаются.
  assert.equal(teamTokenFromRequest(fakeRequest({ authorization: 'Basic team-token-1' })), undefined);
  assert.equal(teamTokenFromRequest(fakeRequest({ authorization: 'Bearer  team-token-1' })), undefined);
  assert.equal(teamTokenFromRequest(fakeRequest({ authorization: 'Bearer' })), undefined);
});

test('токен читается из отдельного заголовка X-Team-Token', () => {
  assert.equal(teamTokenFromRequest(fakeRequest({ 'x-team-token': 'team-token-2' })), 'team-token-2');
  // Пробелы вокруг значения не должны ломать доступ: заголовок ставит клиент.
  assert.equal(teamTokenFromRequest(fakeRequest({ 'x-team-token': '  team-token-2  ' })), 'team-token-2');
  assert.equal(teamTokenFromRequest(fakeRequest({ 'x-team-token': '   ' })), undefined);
});

test('приоритет у заголовка Authorization', () => {
  // Если клиент прислал оба заголовка, решает Authorization: иначе подмена
  // X-Team-Token позволяла бы обойти проверку прав.
  const token = teamTokenFromRequest(
    fakeRequest({ authorization: 'Bearer main-token', 'x-team-token': 'другой-токен' })
  );
  assert.equal(token, 'main-token');
});

test('без заголовков токена нет', () => {
  assert.equal(teamTokenFromRequest(fakeRequest({})), undefined);
});
