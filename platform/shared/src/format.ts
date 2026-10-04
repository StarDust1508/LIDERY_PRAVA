// Форматирование значений для интерфейса.
//
// Московское время указывается явной пометкой: «11 декабря 2026 года, 23:59 (МСК)»
// (ТЗ 08, п. 6.4; п. 6.2 Положения). Те же правила, что и в formatMoscowHuman
// на сервере, — чтобы сообщения сервера и подписи интерфейса совпадали.

export const MOSCOW_TIMEZONE = 'Europe/Moscow';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «11 декабря 2026 года, 23:59 (МСК)» */
export function formatMoscowHuman(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  // День и месяц форматируются одним вызовом: в русской локали месяц встаёт
  // в родительный падеж — «11 декабря», а не «11 декабрь».
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

/** «11 декабря 2026 года» */
export function formatMoscowDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const dayAndMonth = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    day: 'numeric',
    month: 'long',
  }).format(date);
  const year = new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TIMEZONE, year: 'numeric' }).format(date);
  return `${dayAndMonth} ${year} года`;
}

/** «23:59 (МСК)» */
export function formatMoscowTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${time} (МСК)`;
}

/** «12 декабря 2026 года, 12:41 (МСК)» — момент автосохранения черновика. */
export function formatSavedAt(value: string | number | Date | null | undefined): string {
  return formatMoscowHuman(value);
}

/**
 * Русское склонение: plural(2, ['участник', 'участника', 'участников'])
 * → «участника». Формы передаются тремя строками: одна, две-четыре, много.
 */
export function plural(count: number, forms: readonly string[]): string {
  const [one, few, many] = forms;
  if (one === undefined || few === undefined || many === undefined) return String(count);
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/** «2 участника», «5 участников» */
export function pluralize(count: number, forms: readonly string[]): string {
  return `${count} ${plural(count, forms)}`;
}

/** Размер файла: 1024 → «1 КБ». */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

/** Остаток до срока словами: «осталось 12 дней». */
export function formatTimeLeft(milliseconds: number): string {
  if (milliseconds <= 0) return 'срок истёк';
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `осталось ${pluralize(days, ['день', 'дня', 'дней'])}`;
  if (hours >= 1) return `осталось ${pluralize(hours, ['час', 'часа', 'часов'])}`;
  return `осталось ${pluralize(Math.max(1, minutes), ['минута', 'минуты', 'минут'])}`;
}

/** Телефон в едином виде: +7 900 000-00-00. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    const rest = digits.slice(1);
    return `+7 ${rest.slice(0, 3)} ${rest.slice(3, 6)}-${rest.slice(6, 8)}-${rest.slice(8, 10)}`;
  }
  return value;
}
