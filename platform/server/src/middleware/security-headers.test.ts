import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { securityHeaders } from './security-headers.js';
import { CSP_MODE } from '../config.js';

// Проверки заголовков безопасности (ТЗ 11, разбор рисков переноса ядра п. 3).
// Тесты фиксируют политику CSP: без 'unsafe-inline' в script-src, без
// 'unsafe-eval', с запретом встраивания в чужие страницы.

function fakeResponse(): { headers: Record<string, string>; res: Response; nextCalled: () => boolean } {
  const headers: Record<string, string> = {};
  let called = false;
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    called = true;
  };
  securityHeaders({} as Request, res, next);
  return { headers, res, nextCalled: () => called };
}

const headerName = CSP_MODE === 'report' ? 'content-security-policy-report-only' : 'content-security-policy';

test('промежуточный слой всегда передаёт управление дальше', () => {
  const { nextCalled } = fakeResponse();
  assert.equal(nextCalled(), true);
});

test('CSP выставляется в режиме enforce и не дублируется в report-only', () => {
  const { headers } = fakeResponse();
  if (CSP_MODE === 'off') {
    assert.equal(headers[headerName], undefined, 'при CSP_MODE=off заголовок не ставится');
    return;
  }
  assert.ok(headers[headerName], `ожидался заголовок ${headerName}`);
  const other = headerName === 'content-security-policy' ? 'content-security-policy-report-only' : 'content-security-policy';
  assert.equal(headers[other], undefined, 'две разные политики в одном ответе противоречат друг другу');
});

test('политика запрещает исполняемый из страницы код', () => {
  const { headers } = fakeResponse();
  const policy = headers[headerName];
  if (!policy) return; // режим off — проверять нечего

  const directive = (name: string): string =>
    policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? '';

  const scriptSrc = directive('script-src');
  assert.ok(scriptSrc.startsWith("script-src 'self'"), `script-src должен разрешать только свои скрипты: ${scriptSrc}`);
  assert.ok(!scriptSrc.includes('unsafe-inline'), "script-src не должен содержать 'unsafe-inline'");
  assert.ok(!scriptSrc.includes('unsafe-eval'), "script-src не должен содержать 'unsafe-eval'");
  assert.ok(!policy.includes('*'), 'в политике не должно быть подстановочного источника');

  assert.equal(directive('default-src'), "default-src 'self'");
  assert.equal(directive('object-src'), "object-src 'none'");
  assert.equal(directive('base-uri'), "base-uri 'self'");
  assert.equal(directive('form-action'), "form-action 'self'");
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'");
  assert.ok(policy.includes('upgrade-insecure-requests'), 'трафик должен подниматься до https');
});

test("'unsafe-inline' остаётся только в стилях", () => {
  const { headers } = fakeResponse();
  const policy = headers[headerName];
  if (!policy) return;
  const withInline = policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes('unsafe-inline'))
    .map((part) => part.split(' ')[0]);
  assert.deepEqual(withInline, ['style-src'], `unsafe-inline допустим только для стилей, найден: ${withInline.join(', ')}`);
});

test('шрифты, картинки и медиа ограничены списком источников', () => {
  const { headers } = fakeResponse();
  const policy = headers[headerName];
  if (!policy) return;

  const directive = (name: string): string =>
    policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? '';

  assert.ok(directive('font-src').startsWith("font-src 'self'"));
  assert.ok(directive('img-src').startsWith("img-src 'self'"));

  // Видео участников живёт на российских платформах — они разрешены явно.
  for (const origin of ['https://vk.com', 'https://vk.ru', 'https://rutube.ru']) {
    assert.ok(directive('media-src').includes(origin), `media-src должен разрешать ${origin}`);
    assert.ok(directive('frame-src').includes(origin), `frame-src должен разрешать ${origin}`);
  }
  // Никаких youtube/google — внешние трекеры не подключены.
  assert.ok(!policy.includes('youtube'), 'в политике не должно быть незаявленных внешних источников');
});

test('X-Content-Type-Options защищает от подмены типа', () => {
  const { headers } = fakeResponse();
  assert.equal(headers['x-content-type-options'], 'nosniff');
});

test('приложение не дублирует заголовки, которые отдаёт nginx', () => {
  const { headers } = fakeResponse();
  // Дублирование политик в двух местах приводило бы к конфликту: транспортные
  // заголовки ставит край, приложение — только CSP.
  for (const name of ['strict-transport-security', 'referrer-policy', 'x-frame-options']) {
    assert.equal(headers[name], undefined, `${name} должен ставиться на краю (nginx), а не в приложении`);
  }
});
