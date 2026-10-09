import { query } from '../db.js';

// Включатели функций (ТЗ 07, п. 2.16): Оргкомитет выключает раздел или приём в
// админке, и это немедленно действует на публичной части и в кабинете.
//
// Значения лежат в site_settings под ключами features.*; чтение кэшируется на
// несколько секунд, чтобы публичные списки не ходили в базу на каждый запрос.
// Если ключа нет, функция считается включённой: система не должна «замолчать»
// из-за отсутствующей строки настроек.

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  value: boolean;
  at: number;
}

const cache = new Map<string, CacheEntry>();

/** Значение включателя: true — функция работает. */
export async function featureEnabled(name: string, fallback = true): Promise<boolean> {
  const key = `features.${name}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const result = await query('SELECT value FROM site_settings WHERE key = $1 LIMIT 1', [key]);
    const raw = result.rows[0]?.value?.value;
    const value = raw === undefined || raw === null ? fallback : raw === true || raw === 'true';
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    // Ошибка чтения настроек не должна закрывать конкурс: работаем по fallback.
    return fallback;
  }
}

/** Сбрасывает кэш: вызывается после изменения настроек в админке. */
export function resetFeatureCache(): void {
  cache.clear();
}
