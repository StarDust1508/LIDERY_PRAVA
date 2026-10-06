// Валидация пользовательского ввода для публичных форм и личного кабинета.
// Проверки намеренно строгие: ПДн участников принимаются только в корректном виде.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/;

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Телефон: 10–15 цифр, допускаются пробелы, скобки, дефис и ведущий +. */
export function isPhone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/** Строка ограниченной длины; null, если значение пустое. */
export function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, maxLength);
}

/** Обязательная строка ограниченной длины. */
export function requiredText(value: unknown, maxLength: number): string | null {
  const text = optionalText(value, maxLength);
  return text && text.length > 0 ? text : null;
}

/** Дата в формате YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** Возраст в полных годах на указанную дату. */
export function ageOn(birthDate: string, onDate: Date): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let age = onDate.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = onDate.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** Требования к участнику: от 16 до 35 лет включительно (п. 4.1 Положения). */
export const PARTICIPANT_MIN_AGE = 16;
export const PARTICIPANT_MAX_AGE = 35;

/** Категории участника по п. 4.1 Положения. */
export const PARTICIPANT_CATEGORIES = [
  'student',
  'magistrant',
  'aspirant',
  'young_specialist',
  'mo_leader',
] as const;

export type ParticipantCategory = (typeof PARTICIPANT_CATEGORIES)[number];

export function isParticipantCategory(value: unknown): value is ParticipantCategory {
  return typeof value === 'string' && (PARTICIPANT_CATEGORIES as readonly string[]).includes(value);
}

/** Уровень акта по Приложению № 1. */
export const ACT_LEVELS = ['federal_constitutional', 'federal', 'regional'] as const;

export type ActLevel = (typeof ACT_LEVELS)[number];

export function isActLevel(value: unknown): value is ActLevel {
  return typeof value === 'string' && (ACT_LEVELS as readonly string[]).includes(value);
}

export function isValidExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    // ТЗ 11, п. 5.7: протоколы кроме https: отклоняются. Открытый http
    // позволял подменить содержимое материала по пути и вводил участника в
    // заблуждение относительно защиты канала.
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Ссылки на конкурсные материалы ───────────────────────────────────────────
// Пункт 14.4 Положения: размещение конкурсных материалов в облачных хранилищах
// допускается только в сервисах, принадлежащих юридическим лицам,
// зарегистрированным на территории Российской Федерации.
//
// Список — это разрешение, а не запрет: незнакомый домен отклоняется, потому что
// проверить его принадлежность автоматически нельзя. Оргкомитет может расширить
// перечень в коде осознанно, а не «на глазок» в интерфейсе.

export const ALLOWED_MATERIAL_DOMAINS: readonly string[] = [
  // «ВКонтакте» — основная площадка конкурса (п. 8.3).
  'vk.com',
  'vk.ru',
  'vkvideo.ru',
  // Российские облачные хранилища.
  'disk.yandex.ru',
  'yandex.ru',
  'ya.ru',
  'cloud.mail.ru',
  'mail.ru',
  // Видео и публикации российских сервисов.
  'rutube.ru',
  'dzen.ru',
  'ok.ru',
  '1c.ru',
];

/** Домен входит в перечень разрешённых (сравнение по суффиксу домена). */
export function isAllowedMaterialUrl(value: unknown): value is string {
  if (!isValidExternalUrl(value)) return false;
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return ALLOWED_MATERIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** Понятное сообщение об отказе: что именно не так со ссылкой. */
export const MATERIAL_URL_POLICY_MESSAGE =
  'Ссылка должна вести на сервис, зарегистрированный в Российской Федерации: «ВКонтакте», Яндекс.Диск, Облако Mail.ru, Rutube, Дзен, Одноклассники. ' +
  'Размещение конкурсных материалов в зарубежных облачных хранилищах не допускается (п. 14.4 Положения).';
