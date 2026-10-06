import type { NextFunction, Request, Response } from 'express';
import { CSP_EXTRA_ORIGINS, CSP_MODE } from '../config.js';

// Content-Security-Policy — единственный заголовок безопасности, который ставит
// приложение. Транспортные заголовки (HSTS, X-Content-Type-Options,
// Referrer-Policy, X-Frame-Options) отдаёт nginx на краю: он покрывает и статику,
// которую Express не обслуживает. Дублировать их здесь нельзя — иначе в ответе
// окажется два разных набора политик.
//
// Политика собрана из собственных ресурсов сайта плюс origin-ов из
// CSP_EXTRA_ORIGINS (аналитика, внешние шрифты). Домены в код не вшиты.
//
// Режим задаётся CSP_MODE: enforce (по умолчанию) | report | off.

function buildCsp(extraOrigins: string[]): string {
  const extra = extraOrigins.join(' ').trim();
  const withExtra = (base: string): string => (extra ? `${base} ${extra}` : base);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // 'none' — согласовано с X-Frame-Options: DENY на краю (nginx): два разных
    // значения в одном ответе противоречили друг другу.
    "frame-ancestors 'none'",
    "form-action 'self'",
    withExtra("script-src 'self'"),
    withExtra("style-src 'self' 'unsafe-inline'"),
    withExtra("img-src 'self' data: blob:"),
    // Видео мастер-классов и ролики участников могут быть размещены на
    // российских видеоплатформах: их разрешаем явно, остальное — нет.
    "media-src 'self' blob: https://vk.com https://vk.ru https://rutube.ru",
    "frame-src 'self' https://vk.com https://vk.ru https://rutube.ru",
    withExtra("font-src 'self' data:"),
    withExtra("connect-src 'self'"),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const policy = buildCsp(CSP_EXTRA_ORIGINS);

  if (CSP_MODE === 'report') {
    res.setHeader('Content-Security-Policy-Report-Only', policy);
  } else if (CSP_MODE !== 'off') {
    res.setHeader('Content-Security-Policy', policy);
  }

  // Значения по умолчанию, не зависящие от nginx: они безопасны и не конфликтуют
  // с краевыми заголовками.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
