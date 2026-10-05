import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, type PublicMasterclass, api, formatMoscowHuman } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { ActionLink, PageHeader, Prose } from '@/components/PageBlocks';
import { useTrailLabel } from '@/components/Breadcrumbs';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Карточка мастер-класса (ТЗ 08, п. 4.2–4.3).
//
// Для анонса страница объясняет, что будет на встрече и как подключиться; для
// прошедшего — отдаёт запись и материалы. Запись воспроизводится прямо на сайте:
// ссылки «ВКонтакте» и Rutube встраиваются плеером, загруженный файл играется
// элементом video.

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

/** Адрес записи: загруженный файл, ссылка на который отдаётся карточкой. */
function recordingFileUrl(item: PublicMasterclass): string | null {
  if (item.recording_file_url) return item.recording_file_url;
  if (item.media_id) return `/api/media/file/${item.media_id}`;
  return null;
}

/** Плеер записи: встроенный для разрешённых сервисов, иначе файл или ссылка. */
function RecordingPlayer({ item }: { item: PublicMasterclass }) {
  const embed = embedUrl(item.recording_url);
  if (embed) {
    return (
      <figure>
        <div className="relative aspect-video w-full border border-border">
          <iframe
            src={embed}
            title={`Запись мастер-класса: ${item.title}`}
            loading="lazy"
            allow="clipboard-write; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
        <figcaption className="mt-2 text-sm text-muted">Запись мастер-класса: {item.title}</figcaption>
      </figure>
    );
  }

  const fileUrl = recordingFileUrl(item);
  if (fileUrl) {
    return (
      <figure>
        <video
          controls
          preload="metadata"
          aria-label={`Запись мастер-класса: ${item.title}`}
          className="w-full border border-border"
        >
          <source src={fileUrl} />
          Ваш браузер не поддерживает воспроизведение видео.{' '}
          <a href={fileUrl} className="text-accent underline underline-offset-2">
            Открыть запись
          </a>
          .
        </video>
        <figcaption className="mt-2 text-sm text-muted">
          Запись мастер-класса: {item.title}.{' '}
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Открыть в новой вкладке
          </a>
        </figcaption>
      </figure>
    );
  }

  if (item.recording_url) {
    return (
      <p className="text-sm">
        Запись опубликована на внешнем сервисе:{' '}
        <a
          href={item.recording_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          смотреть запись
        </a>
        .
      </p>
    );
  }

  return <p className="text-sm text-muted">Запись готовится к публикации.</p>;
}

export function MasterclassPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [item, setItem] = useState<PublicMasterclass | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useTrailLabel(item?.title ?? null);

  useSeo({
    title: item?.title ?? 'Мастер-класс',
    description:
      item?.description ??
      'Мастер-класс конкурса «Лидеры права – 2027» для команд-финалистов: тема, спикер, дата и время по Москве, запись и материалы.',
    path: `/masterclasses/${slug}`,
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Мастер-классы', path: '/masterclasses' },
      ...(item ? [{ name: item.title, path: `/masterclasses/${item.slug ?? slug}` }] : []),
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
        const data = await api.masterclass(slug);
        if (active) setItem(data);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 404) setNotFound(true);
        else setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить мастер-класс.');
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
        <p role="status">Загружаем мастер-класс…</p>
      </main>
    );
  }

  if (notFound || !item) {
    return (
      <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
        <PageHeader
          eyebrow="Мастер-классы"
          title="Мастер-класс не найден"
          lead="Встреча с таким адресом не опубликована или её адрес изменился."
        />
        <SectionCard title="Что можно сделать" description="Анонсы и записи собраны в разделе «Мастер-классы».">
          <Prose>
            <p className="text-sm">
              Возможно, ссылка устарела или содержит опечатку. Откройте список мастер-классов: там есть анонсы
              предстоящих встреч и записи прошедших.
            </p>
          </Prose>
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionLink to="/masterclasses">Все мастер-классы</ActionLink>
            <ActionLink to="/masterclasses/past" variant="secondary">
              Записи прошедших
            </ActionLink>
          </div>
        </SectionCard>
      </main>
    );
  }

  const isPast = item.status === 'past';

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow={isPast ? 'Мастер-класс · запись' : 'Мастер-класс · анонс'}
        title={item.title}
        lead={item.topic ?? undefined}
        actions={
          <ActionLink to="/masterclasses" variant="secondary">
            Все мастер-классы
          </ActionLink>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <SectionCard title="О мастер-классе" description="Дата и время указаны по московскому времени.">
        <dl className="grid gap-5 text-sm md:grid-cols-2">
          <div>
            <dt className="mono-label text-muted">Дата и время</dt>
            <dd className="mt-1">{formatMoscowHuman(item.starts_at)}</dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Спикер</dt>
            <dd className="mt-1">
              {item.speaker}
              {item.speaker_info ? <span className="block text-muted">{item.speaker_info}</span> : null}
            </dd>
          </div>
          {item.topic ? (
            <div>
              <dt className="mono-label text-muted">Тема</dt>
              <dd className="mt-1">{item.topic}</dd>
            </div>
          ) : null}
          <div>
            <dt className="mono-label text-muted">Место и формат</dt>
            <dd className="mt-1">{item.place ?? (isPast ? 'прошедшая встреча' : 'формат уточняется')}</dd>
          </div>
          {item.season_title ? (
            <div>
              <dt className="mono-label text-muted">Сезон</dt>
              <dd className="mt-1">{item.season_title}</dd>
            </div>
          ) : null}
        </dl>
        {item.description ? (
          <p className="mt-5 max-w-measure text-sm">{item.description}</p>
        ) : (
          <p className="mt-5 text-sm text-muted">
            {isPast ? 'Краткое резюме встречи готовится к публикации.' : 'Описание встречи готовится к публикации.'}
          </p>
        )}
      </SectionCard>

      {isPast ? (
        <SectionCard
          title="Запись мастер-класса"
          description="Прошедший мастер-класс публикуется только при наличии записи."
        >
          <RecordingPlayer item={item} />
        </SectionCard>
      ) : (
        <SectionCard title="Как подключиться" description="Формат встречи и подключение.">
          <Prose>
            <p className="text-sm">
              {item.place
                ? `Место и формат встречи: ${item.place}. Уточнения по подключению Оргкомитет публикует на этой странице.`
                : 'Формат встречи и ссылку на подключение Оргкомитет публикует на этой странице до начала мастер-класса.'}
            </p>
            <p className="text-sm text-muted">Напоминание придёт после подключения рассылки.</p>
          </Prose>
        </SectionCard>
      )}

      <SectionCard
        title="Материалы"
        description={isPast ? 'Материалы встречи.' : 'Что подготовить к встрече.'}
      >
        <Prose>
          <p className="text-sm">
            {isPast
              ? 'Материалы к прошедшим мастер-классам Оргкомитет размещает в разделе «Документы»; запись доступна выше на этой странице.'
              : 'Специальная подготовка не требуется. Полезные документы конкурса — Положение и Приложения № 1–14 — собраны в разделе «Документы».'}
          </p>
        </Prose>
        <p className="mt-4 text-sm">
          <Link to="/documents" className="text-accent underline underline-offset-2">
            Документы конкурса
          </Link>{' '}
          ·{' '}
          <Link to="/masterclasses/past" className="text-accent underline underline-offset-2">
            Записи прошедших мастер-классов
          </Link>
        </p>
      </SectionCard>
    </main>
  );
}
