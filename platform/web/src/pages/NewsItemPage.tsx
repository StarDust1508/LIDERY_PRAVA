import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, type PublicNewsItem, api, formatMoscowHuman } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, Section } from '@/components/PageBlocks';
import { useTrailLabel } from '@/components/Breadcrumbs';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Отдельная публикация или видеосюжет (ТЗ 08, п. 2.1 и 5.3).
//
// Материал доступен по постоянной ссылке, подпись в хлебных крошках берётся из
// заголовка публикации. Если материал не найден, страница не превращается в
// тупик: объясняет ситуацию и ведёт к списку публикаций.

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

export function NewsItemPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [item, setItem] = useState<PublicNewsItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useTrailLabel(item?.title ?? null);

  useSeo({
    title: item?.title ?? 'Публикация',
    description:
      item?.excerpt ??
      'Публикация конкурса «Лидеры права – 2027»: новости этапов, итоги и видеосюжеты о конкурсе.',
    path: `/news/${slug}`,
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Новости', path: '/news' },
      ...(item ? [{ name: item.title, path: `/news/${item.slug}` }] : []),
    ]),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    setError(null);
    setItem(null);
    void (async () => {
      try {
        const data = await api.newsItem(slug);
        if (active) setItem(data);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 404) setNotFound(true);
        else setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить публикацию.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
        <p role="status">Загружаем публикацию…</p>
      </main>
    );
  }

  if (notFound || !item) {
    return (
      <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
        <PageHeader
          eyebrow="Новости"
          title="Публикация не найдена"
          lead="Материал с таким адресом не опубликован или его адрес изменился."
        />
        <Section title="Что можно сделать" description="Публикации конкурса доступны в разделе «Новости».">
          <Prose>
            <p className="text-sm">
              Возможно, ссылка устарела или содержит опечатку. Откройте список публикаций — там есть все новости и
              видеосюжеты конкурса.
            </p>
          </Prose>
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionLink to="/news">Все новости</ActionLink>
            <ActionLink to="/news?type=video" variant="secondary">
              Видеосюжеты
            </ActionLink>
          </div>
          <p className="mt-4 text-sm text-muted">
            Если материал был опубликован и пропал, напишите в Оргкомитет через раздел{' '}
            <Link to="/contacts" className="text-accent underline underline-offset-2">
              «Контакты»
            </Link>
            .
          </p>
        </Section>
      </main>
    );
  }

  const isVideo = item.type === 'video';
  const frame = isVideo ? embedUrl(item.video_url) : null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow={isVideo ? 'Видеосюжет' : 'Новость'}
        title={item.title}
        lead={item.published_at ? formatMoscowHuman(item.published_at) : undefined}
        actions={
          <ActionLink to="/news" variant="secondary">
            Все новости
          </ActionLink>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <article className="flex flex-col gap-6">
        {frame ? <VideoFrame url={frame} title={item.title} /> : null}
        {isVideo && item.video_url && !frame ? (
          <p className="text-sm">
            Видео опубликовано на внешнем сервисе:{' '}
            <a
              href={item.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              смотреть видеосюжет
            </a>
            .
          </p>
        ) : null}

        {item.cover_url ? (
          <img
            src={item.cover_url}
            alt={item.title}
            loading="lazy"
            className="w-full border border-border object-cover"
          />
        ) : null}

        {item.excerpt ? <p className="max-w-measure text-lead text-muted">{item.excerpt}</p> : null}

        {item.body ? (
          <Prose>
            <div className="text-sm whitespace-pre-line">{item.body}</div>
          </Prose>
        ) : (
          <p className="text-sm text-muted">Полный текст публикации готовится к размещению.</p>
        )}
      </article>

      <p className="text-sm text-muted">
        <Link to="/news" className="text-accent underline underline-offset-2">
          Все новости и видео
        </Link>{' '}
        · <Link to="/masterclasses/past" className="text-accent underline underline-offset-2">Записи мастер-классов</Link>
      </p>
    </main>
  );
}
