// Работа со сроками конкурса. Пункт 6.2 Положения: все сроки определяются по
// московскому времени (UTC+3), окончание срока — 23:59 последнего дня.
//
// Важно: в БД сроки хранятся как TIMESTAMPTZ (момент времени), поэтому сравнение
// с текущим моментом не зависит от часового пояса сервера. Смещение +03:00
// применяется только при разборе календарных дат из Положения.

export const MOSCOW_TIMEZONE = 'Europe/Moscow';
export const MOSCOW_UTC_OFFSET = '+03:00';

/** Текущий момент времени (сам по себе не зависит от пояса). */
export function nowInstant(): Date {
  return new Date();
}

/** Конец московских суток для даты вида YYYY-MM-DD: 23:59:59.999 по Москве. */
export function endOfDayMoscow(isoDate: string): Date {
  const parsed = new Date(`${isoDate}T23:59:59.999${MOSCOW_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Некорректная дата для расчёта срока: «${isoDate}»`);
  }
  return parsed;
}

/** Начало московских суток для даты вида YYYY-MM-DD: 00:00:00.000 по Москве. */
export function startOfDayMoscow(isoDate: string): Date {
  const parsed = new Date(`${isoDate}T00:00:00.000${MOSCOW_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Некорректная дата для расчёта срока: «${isoDate}»`);
  }
  return parsed;
}

/** Приводит значение из БД (Date | строка | null) к Date. */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Истёк ли срок. Пустой срок трактуется как «срок не ограничен» (false):
 * так ведут себя демонстрационные сезоны без заполненного календаря.
 */
export function isDeadlinePassed(deadline: Date | string | null | undefined): boolean {
  const date = toDate(deadline);
  if (!date) return false;
  return nowInstant().getTime() > date.getTime();
}

/**
 * Окно приёма заявок: до открытия, открыто или закрыто.
 * Различать эти состояния обязательно: до 11 ноября 2026 года приём ещё не
 * начался, и подпись «приём завершён» была бы неверной.
 */
export function applicationWindowState(
  openAt: Date | string | null | undefined,
  closeAt: Date | string | null | undefined
): 'before' | 'open' | 'closed' {
  const open = toDate(openAt);
  const close = toDate(closeAt);
  const now = nowInstant().getTime();
  if (open && now < open.getTime()) return 'before';
  if (close && now > close.getTime()) return 'closed';
  return 'open';
}

/** Сколько миллисекунд осталось до срока (0, если срок уже прошёл). */
export function millisecondsUntil(deadline: Date | string | null | undefined): number {
  const date = toDate(deadline);
  if (!date) return 0;
  return Math.max(0, date.getTime() - nowInstant().getTime());
}

/** Человекочитаемое представление момента в московском времени. */
export function formatMoscow(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Дата и время в виде, принятом для текстов интерфейса и сообщений:
 * «11 декабря 2026 года, 23:59 (МСК)» (ТЗ 08, п. 6.4). Московское время
 * указывается явной пометкой, а не догадкой читателя.
 */
export function formatMoscowHuman(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  // День и месяц форматируются одним вызовом: в русской локали месяц тогда
  // встаёт в родительный падеж — «11 ноября», а не «11 ноябрь».
  const dayAndMonth = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    day: 'numeric',
    month: 'long',
  }).format(date);
  const year = new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TIMEZONE, year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${dayAndMonth} ${year} года, ${time} (МСК)`;
}

/**
 * Дата без времени по-русски: «3 марта 2001 года». Для дат рождения и дат
 * согласований, где время суток не имеет смысла. Значение приводится к
 * московскому времени, поэтому дата не «съезжает» на сутки.
 */
export function formatMoscowDateHuman(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  const dayAndMonth = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    day: 'numeric',
    month: 'long',
  }).format(date);
  const year = new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TIMEZONE, year: 'numeric' }).format(date);
  return `${dayAndMonth} ${year} года`;
}

/** Добавляет к моменту заданное число рабочих дней (для апелляций, п. 12.1). */
export function addWorkingDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}
