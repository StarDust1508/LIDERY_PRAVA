// Минимальный экспорт в CSV для выгрузок из админ-панели. Отдельная библиотека
// не нужна: данные плоские, а экранирование умещается в одну функцию.

/** Экранирует значение по RFC 4180 и всегда оборачивает его в кавычки. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Собирает CSV. Ведущий BOM нужен, чтобы Excel открывал кириллицу корректно.
 */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(cell).join(';')];
  for (const row of rows) lines.push(row.map(cell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
