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
    "frame-ancestors 'self'",
    "form-action 'self'",
    withExtra("script-src 'self'"),
    withExtra("style-src 'self' 'unsafe-inline'"),
    withExtra("img-src 'self' data: blob:"),
    "media-src 'self' blob:",
    withExtra("font-src 'self' data:"),
    withExtra("connect-src 'self'"),
    withExtra("frame-src 'self'"),
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
