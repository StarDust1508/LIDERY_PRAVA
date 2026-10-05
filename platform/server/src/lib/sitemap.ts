import { PUBLIC_BASE_URL } from '../config.js';
import { query } from '../db.js';

// Карта сайта (ТЗ 08, п. 2 и 5): собирается из базы, потому что архив
// законопроектов, победители по годам и юридические документы появляются
// по мере работы Оргкомитета. Статический файл пришлось бы обновлять руками.

/** Реализованные публичные маршруты сборки platform/web. */
const STATIC_PATHS: ReadonlyArray<{ path: string; priority: string }> = [
  { path: '/', priority: '1.0' },
  { path: '/about', priority: '0.8' },
  { path: '/about/regulations', priority: '0.8' },
  { path: '/about/faq', priority: '0.6' },
  { path: '/stages', priority: '0.8' },
  { path: '/stages/calendar', priority: '0.7' },
  { path: '/stages/criteria', priority: '0.7' },
  { path: '/participants', priority: '0.7' },
  { path: '/participants/requirements', priority: '0.6' },
  { path: '/participants/materials', priority: '0.7' },
  { path: '/apply', priority: '0.9' },
  { path: '/initiatives', priority: '0.8' },
  { path: '/masterclasses', priority: '0.6' },
  { path: '/winners', priority: '0.8' },
  { path: '/documents', priority: '0.7' },
  { path: '/contacts', priority: '0.5' },
];

/** Пути юридических документов зависят от типа записи в documents. */
const LEGAL_PATHS: Record<string, string> = {
  offer: '/legal/offer',
  privacy_policy: '/legal/privacy',
  terms: '/legal/terms',
  cookies_policy: '/legal/cookies',
  jury_regulations: '/legal/jury-regulations',
  mailing_consent: '/legal/mailing-consent',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

interface SitemapEntry {
  loc: string;
  priority: string;
  changefreq: string;
  lastmod?: string | null;
}

/** Собирает XML карты сайта: статические маршруты, документы, архив, победители. */
export async function buildSitemap(): Promise<string> {
  const entries: SitemapEntry[] = STATIC_PATHS.map((item) => ({
    loc: `${PUBLIC_BASE_URL}${item.path}`,
    priority: item.priority,
    changefreq: 'weekly',
  }));

  // Юридические документы: только действующие редакции.
  const documents = await query(
    `SELECT type, revision_date FROM documents
      WHERE is_active AND type IN ('offer','privacy_policy','terms','cookies_policy','jury_regulations','mailing_consent')`
  );
  for (const row of documents.rows) {
    const path = LEGAL_PATHS[String(row.type)];
    if (!path) continue;
    entries.push({
      loc: `${PUBLIC_BASE_URL}${path}`,
      priority: '0.4',
      changefreq: 'yearly',
      lastmod: isoDate(row.revision_date),
    });
  }

  // Архив законопроектов: только опубликованные инициативы.
  const initiatives = await query(
    `SELECT slug, published_at FROM initiatives WHERE is_published ORDER BY published_at DESC NULLS LAST LIMIT 5000`
  );
  for (const row of initiatives.rows) {
    entries.push({
      loc: `${PUBLIC_BASE_URL}/initiatives/${encodeURIComponent(String(row.slug))}`,
      priority: '0.6',
      changefreq: 'monthly',
      lastmod: isoDate(row.published_at),
    });
  }

  // Победители по годам.
  const years = await query(
    `SELECT DISTINCT season_year FROM winners WHERE is_published ORDER BY season_year DESC`
  );
  for (const row of years.rows) {
    entries.push({
      loc: `${PUBLIC_BASE_URL}/winners/${row.season_year}`,
      priority: '0.6',
      changefreq: 'yearly',
    });
  }

  const body = entries
    .map(
      (entry) =>
        '  <url>' +
        `<loc>${escapeXml(entry.loc)}</loc>` +
        (entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : '') +
        `<changefreq>${entry.changefreq}</changefreq>` +
        `<priority>${entry.priority}</priority>` +
        '</url>'
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
