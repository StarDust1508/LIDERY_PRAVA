import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, type PublicNews, api, formatMoscowHuman } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { PageHeader } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Новости и видеосюжеты (ТЗ 08, п. 2.1 и 5.3).
//
// Фильтр «Все материалы» / «Видеосюжеты» живёт в адресной строке (?type=video):
// ссылку на подборку можно скопировать и переслать. Видео встраивается плеером
// только для разрешённых сервисов — «ВКонтакте» и Rutube; для остальных ссылок
// даётся обычная ссылка «Смотреть», без попытки встроить чужой плеер.

/** Домены, видео с которых разрешено встраивать на сайт. */
function isVkHost(host: string): boolean {
  return (
    host === 'vk.com' ||
    host === 'vk.ru' ||
    host === 'vkvideo.ru' ||
    host.endsWith('.vk.com') ||
    host.endsWith('.vk.ru') ||
    host.endsWith('.vkvideo.ru')
  );
}

/** Адрес встраиваемого плеера или null, если сервис не разрешён. */
function embedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();

  if (isVkHost(host)) {
    if (url.pathname.startsWith('/video_ext.php')) return url.toString();
    const match = /video(-?\d+)_(\d+)/.exec(`${url.pathname}${url.search}`);
    const oid = match?.[1];
    const videoId = match?.[2];
    if (oid && videoId) return `https://vk.com/video_ext.php?oid=${oid}&id=${videoId}&hd=2`;
    return null;
  }

  if (host === 'rutube.ru' || host.endsWith('.rutube.ru')) {
    const embed = /^\/play\/embed\/([\w-]+)\/?$/.exec(url.pathname);
    if (embed?.[1]) return `https://rutube.ru/play/embed/${embed[1]}/`;
    const video = /^\/(?:video|shorts)\/([\w-]+)\/?$/.exec(url.pathname);
    if (video?.[1]) return `https://rutube.ru/play/embed/${video[1]}/`;
    return null;
  }

  return null;
}

/** Встроенный плеер с подписью: сервис разрешён, ссылка проверена. */
function VideoFrame({ url, title }: { url: string; title: string }) {
  return (
    <figure className="mt-4">
      <div className="relative aspect-video w-full border border-border">
        <iframe
          src={url}
          title={`Видео: ${title}`}
          loading="lazy"
          allow="clipboard-write; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
      <figcaption className="mt-2 text-sm text-muted">Видео: {title}</figcaption>
    </figure>
  );
}

export function NewsPage() {
  const [params] = useSearchParams();
  const videoOnly = params.get('type') === 'video';
  const [items, setItems] = useState<PublicNews[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: videoOnly ? 'Видеосюжеты' : 'Новости и видео',
    description: videoOnly
      ? 'Видеосюжеты конкурса «Лидеры права – 2027»: записи выступлений, интервью и ролики участников.'
      : 'Новости и видеосюжеты конкурса «Лидеры права – 2027»: ход этапов, мастер-классы, итоги и публикации Оргкомитета.',
    path: videoOnly ? '/news?type=video' : '/news',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Новости', path: '/news' },
      ...(videoOnly ? [{ name: 'Видеосюжеты', path: '/news?type=video' }] : []),
    ]),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await api.news(videoOnly ? { type: 'video' } : {});
        if (active) setItems(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить публикации.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [videoOnly]);

  const tabClass = (activeTab: boolean) =>
    activeTab
      ? 'mono-label inline-flex min-h-[44px] items-center bg-accent-solid px-5 text-on-accent'
      : 'mono-label inline-flex min-h-[44px] items-center border border-border-strong px-5 hover:border-accent hover:text-accent';

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Новости"
        title="Новости и видео"
        lead="Ход этапов, мастер-классы, итоги и видеосюжеты конкурса. Публикации размещает Оргкомитет; каждая доступна по постоянной ссылке."
      />

      <nav aria-label="Фильтр публикаций" className="flex flex-wrap gap-3">
        <Link to="/news" aria-current={videoOnly ? undefined : 'page'} className={tabClass(!videoOnly)}>
          Все материалы
        </Link>
        <Link to="/news?type=video" aria-current={videoOnly ? 'page' : undefined} className={tabClass(videoOnly)}>
          Видеосюжеты
        </Link>
      </nav>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем публикации…</p>
      ) : items.length === 0 ? (
        <Alert tone="info" title={videoOnly ? 'Видеосюжетов пока нет' : 'Публикаций пока нет'}>
          {videoOnly
            ? 'Видеосюжеты появятся здесь после публикации Оргкомитетом. Посмотрите все материалы — новости конкурса уже могут быть опубликованы.'
            : 'Новости и видеосюжеты появятся здесь после публикации Оргкомитетом. Следите за конкурсом в сообществе во «ВКонтакте».'}
        </Alert>
      ) : (
        <SectionCard
          title={videoOnly ? `Видеосюжеты (${items.length})` : `Публикации (${items.length})`}
          description="Дата публикации указана по московскому времени."
        >
          <ul className="flex flex-col gap-6">
            {items.map((item) => {
              const frame = item.type === 'video' ? embedUrl(item.video_url) : null;
              return (
                <li key={item.id} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                  <article className="flex flex-col gap-4 md:flex-row">
                    {item.cover_url ? (
                      <img
                        src={item.cover_url}
                        alt={item.title}
                        loading="lazy"
                        className="h-44 w-full border border-border object-cover md:h-40 md:w-64"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h2 className="text-h3 font-semibold">
                          <Link to={`/news/${item.slug}`} className="hover:text-accent">
                            {item.title}
                          </Link>
                        </h2>
                        <p className="mono-label text-muted">{item.type === 'video' ? 'Видеосюжет' : 'Новость'}</p>
                      </div>
                      {item.published_at ? (
                        <p className="mono-label mt-1 text-muted">{formatMoscowHuman(item.published_at)}</p>
                      ) : null}
                      {item.excerpt ? <p className="mt-2 max-w-measure text-sm text-muted">{item.excerpt}</p> : null}

                      {frame ? <VideoFrame url={frame} title={item.title} /> : null}
                      {item.type === 'video' && item.video_url && !frame ? (
                        <p className="mt-3 text-sm">
                          <a
                            href={item.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline underline-offset-2"
                          >
                            Смотреть
                          </a>
                        </p>
                      ) : null}

                      <p className="mt-3 text-sm">
                        <Link to={`/news/${item.slug}`} className="text-accent underline underline-offset-2">
                          {item.type === 'video' ? 'Открыть видеосюжет' : 'Читать публикацию'}
                        </Link>
                      </p>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </main>
  );
}
