import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Общие блоки страниц: единый заголовок раздела и типовые секции.
// Все публичные страницы собираются из них — так оформление блоков совпадает
// на всём сайте, а не повторяется в каждой странице по-своему.

export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border pb-6">
      <p className="mono-label text-muted">{eyebrow}</p>
      <h1 className="mt-2 max-w-measure text-h1 font-semibold tracking-[var(--tr-heading)]">{title}</h1>
      {lead ? <p className="mt-4 max-w-measure text-lead text-muted">{lead}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

/** Кнопка-ссылка в стиле дизайн-системы: основная и вторичная. */
export function ActionLink({
  to,
  children,
  variant = 'primary',
  external = false,
}: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  external?: boolean;
}) {
  const className =
    variant === 'primary'
      ? 'mono-label inline-flex min-h-[44px] items-center bg-accent-solid px-5 text-on-accent hover:bg-accent-solid-hover'
      : 'mono-label inline-flex min-h-[44px] items-center border border-border-strong px-5 hover:border-accent hover:text-accent';
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer noopener" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

/** Основной текстовый блок страницы: одинаковая ширина строки и ритм абзацев. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="flex max-w-measure flex-col gap-4 text-body">{children}</div>;
}

/**
 * Таблица, которая на узких экранах превращается в карточки (ТЗ 08, п. 3.6).
 * Строки передаются один раз и выводятся двумя способами: без дублирования
 * разметки руками на каждой странице.
 */
export function ResponsiveTable<T>({
  caption,
  columns,
  rows,
  renderCell,
  rowKey,
}: {
  caption: string;
  columns: string[];
  rows: T[];
  renderCell: (row: T, columnIndex: number) => ReactNode;
  rowKey: (row: T) => string | number;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only-text">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted">
              {columns.map((column) => (
                <th key={column} scope="col" className="py-2 pr-4">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border align-top">
                {columns.map((column, index) => (
                  <td key={column} className="py-3 pr-4">
                    {renderCell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-4 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="border border-border p-4">
            <dl className="flex flex-col gap-2">
              {columns.map((column, index) => (
                <div key={column}>
                  <dt className="mono-label text-muted">{column}</dt>
                  <dd className="mt-1">{renderCell(row, index)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Оглавление длинной страницы: закреплено слева на широких экранах. */
export function TableOfContents({ items }: { items: Array<{ id: string; title: string }> }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Содержание страницы" className="lg:sticky lg:top-24 lg:self-start">
      <p className="mono-label text-muted">Содержание</p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {items.map((item, index) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="underline underline-offset-2 hover:text-accent">
              {index + 1}. {item.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
