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
  breadcrumbs: crumbs,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Крошки прежнего сайта: «Главная / Раздел» (ТЗ 08, п. 1.3.4). */
  breadcrumbs?: Array<{ title: string; path: string }>;
}) {
  // Разметка повторяет .phero прежнего сайта: крошки, плакатный заголовок,
  // лид и волосяная линия под блоком.
  return (
    <header className="phero">
      <div className="wrap">
        {crumbs && crumbs.length > 0 ? (
          <div className="crumbs mono">
            {crumbs.map((crumb, index) => (
              <span key={crumb.path}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}{' '}
                {index === crumbs.length - 1 ? (
                  <span aria-current="page">{crumb.title}</span>
                ) : (
                  <Link to={crumb.path}>{crumb.title}</Link>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="crumbs mono">{eyebrow}</div>
        )}
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Раздел страницы: блок прежнего сайта (`.block` с `.sec-label` и заголовком).
 * Используется всеми публичными страницами вместо карточек, поэтому блоки
 * выглядят одинаково по всему сайту.
 */
export function Section({
  title,
  description,
  children,
  footer,
  actions,
  sand = false,
  label,
  id,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  /** Песочный фон: чередование блоков, как на прежнем сайте. */
  sand?: boolean;
  /** Метка раздела в скобках: «(О конкурсе)». */
  label?: string;
  id?: string;
}) {
  return (
    <section className={`block${sand ? ' sand' : ''}`} id={id}>
      <div className="wrap">
        {label ? <div className="sec-label mono">{label}</div> : null}
        {title || description || actions ? (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              {title ? <h2>{title}</h2> : null}
              {description ? <p className="max-w-measure text-sm">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        ) : null}
        {children}
        {footer ? <footer className="mt-6">{footer}</footer> : null}
      </div>
    </section>
  );
}

/** Сетка с волосяными линиями: используется для показателей и карточек. */
export function HairlineGrid({
  children,
  columns = 'repeat(auto-fit, minmax(220px, 1fr))',
}: {
  children: ReactNode;
  columns?: string;
}) {
  return (
    <div className="hairline-grid" style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  );
}

/** Ячейка сетки: заголовок, текст и, при необходимости, изображение. */
export function GridCell({
  title,
  text,
  num,
  imageUrl,
  imageAlt,
  imageCaption,
  action,
}: {
  title?: string;
  text?: ReactNode;
  num?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
  action?: ReactNode;
}) {
  return (
    <div className="hairline-cell">
      {imageUrl ? (
        <figure className="media-frame mb-2 aspect-[4/3]">
          <img src={imageUrl} alt={imageAlt ?? ''} loading="lazy" className="media-cover" />
          {imageCaption ? <figcaption className="sr-only-text">{imageCaption}</figcaption> : null}
        </figure>
      ) : null}
      {num ? <span className="stat-num">{num}</span> : null}
      {title ? <h3 className="poster-3">{title}</h3> : null}
      {text ? <div className="text-sm text-muted">{text}</div> : null}
      {action ? <div className="mt-auto pt-3">{action}</div> : null}
    </div>
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
