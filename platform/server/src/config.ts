import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Файл окружения ищем в двух привычных местах: platform/.env (основное) и
// platform/server/.env (локальное переопределение). dotenv не перезаписывает уже
// заданные переменные, поэтому приоритет у platform/.env.
dotenv.config({ path: path.resolve(currentDir, '../../.env') });
dotenv.config({ path: path.resolve(currentDir, '../.env') });

/** Обязательные переменные: без них процесс не должен стартовать. */
const REQUIRED_VARS = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'JWT_SECRET',
  'ADMIN_SESSION_SECRET',
  'ADMIN_PASSWORD',
] as const;

function readRaw(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function requireString(name: string, minLength = 1): string {
  const value = readRaw(name);
  if (value === undefined) {
    throw new Error(
      `Не задана обязательная переменная окружения ${name}. ` +
        `Добавьте её в platform/.env (образец — platform/server/.env.example).`
    );
  }
  if (value.length < minLength) {
    throw new Error(`Переменная ${name} слишком короткая: минимум ${minLength} символов.`);
  }
  return value;
}

function optionalString(name: string, fallback: string): string {
  return readRaw(name) ?? fallback;
}

function optionalInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readRaw(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Переменная ${name} должна быть целым числом, получено «${raw}».`);
  }
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Проверяет все обязательные переменные сразу и сообщает обо всех пропусках
 * одним списком — так понятнее, чем падать на первой же.
 */
function collectMissing(): string[] {
  return REQUIRED_VARS.filter((name) => readRaw(name) === undefined);
}

const missing = collectMissing();
if (missing.length > 0) {
  throw new Error(
    `Не заданы обязательные переменные окружения: ${missing.join(', ')}. ` +
      'Скопируйте platform/server/.env.example в platform/.env и заполните значения. ' +
      'Секреты хранятся только в окружении и не имеют значений по умолчанию.'
  );
}

/** Проверяет, что строка — безопасное имя схемы (буквы, цифры, подчёркивание). */
export function sanitizeSchemaName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '');
  if (!sanitized) throw new Error('DATABASE_SCHEMA не может быть пустым');
  if (sanitized !== name) {
    throw new Error(`DATABASE_SCHEMA содержит недопустимые символы: «${name}».`);
  }
  return sanitized;
}

/** Экранирование текста для вставки в HTML. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  const parts = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parts.length > 0 ? parts : fallback;
}

// ── HTTP-сервер ──────────────────────────────────────────────────────────────
export const NODE_ENV: string = optionalString('NODE_ENV', 'development');
export const IS_PRODUCTION: boolean = NODE_ENV === 'production';
export const API_HOST: string = optionalString('API_HOST', '127.0.0.1');
export const API_PORT: number = optionalInt('API_PORT', 3001, 1, 65535);

// ── База данных ──────────────────────────────────────────────────────────────
export const DATABASE_HOST: string = requireString('DATABASE_HOST');
export const DATABASE_PORT: number = optionalInt('DATABASE_PORT', 5432, 1, 65535);
export const DATABASE_NAME: string = requireString('DATABASE_NAME');
export const DATABASE_USER: string = requireString('DATABASE_USER');
export const DATABASE_PASSWORD: string = requireString('DATABASE_PASSWORD');
// Единственная схема проекта: и доменные таблицы, и служебные (медиа, настройки).
export const DATABASE_SCHEMA: string = sanitizeSchemaName(optionalString('DATABASE_SCHEMA', 'liders'));

// ── Секреты ──────────────────────────────────────────────────────────────────
// Требование к длине: 32 символа — тот же порог, что и для ключа админ-сессий.
export const JWT_SECRET: string = requireString('JWT_SECRET', 32);
export const JWT_EXPIRES_IN: string = optionalString('JWT_EXPIRES_IN', '7d');

export const ADMIN_SESSION_SECRET: string = requireString('ADMIN_SESSION_SECRET', 32);
export const ADMIN_SESSION_TTL_HOURS: number = optionalInt('ADMIN_SESSION_TTL_HOURS', 12, 1, 24);
// Автоматический выход при бездействии (ТЗ 07, п. 1.2). По умолчанию 60 минут.
export const ADMIN_IDLE_MINUTES: number = optionalInt('ADMIN_IDLE_MINUTES', 60, 5, 720);
export const ADMIN_LOGIN: string | undefined = readRaw('ADMIN_LOGIN');
export const ADMIN_PASSWORD: string = requireString('ADMIN_PASSWORD', 8);

// ── Файлы ────────────────────────────────────────────────────────────────────
export const MAX_FILE_SIZE: number = optionalInt('MAX_FILE_SIZE', 25 * 1024 * 1024, 1024, 100 * 1024 * 1024);
export const MEDIA_PUBLIC_CACHE_SECONDS: number = optionalInt(
  'MEDIA_PUBLIC_CACHE_SECONDS',
  31_536_000,
  0,
  31_536_000
);

// ── Публичный адрес, CORS, CSP ───────────────────────────────────────────────
export const PUBLIC_BASE_URL: string = optionalString('PUBLIC_BASE_URL', 'https://lideryprava.ru').replace(
  /\/+$/,
  ''
);
// По умолчанию разрешаем только локальную разработку; боевые домены задаются в .env.
export const CORS_ORIGINS: string[] = parseList(readRaw('CORS_ORIGINS'), [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
export const CSP_MODE: string = optionalString('CSP_MODE', 'enforce').toLowerCase();
export const CSP_EXTRA_ORIGINS: string[] = parseList(readRaw('CSP_EXTRA_ORIGINS'), []);
