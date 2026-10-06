import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type PublicMasterclass, api, formatMoscowHuman } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Записи прошедших мастер-классов (ТЗ 08, п. 2.1 и 4.3).
//
// Запись доступна для просмотра прямо на сайте: ссылка на «ВКонтакте» или
// Rutube встраивается плеером, загруженный файл воспроизводится элементом video.
// Прошедший мастер-класс без записи не публикуется (ТЗ 04, п. 3.6): такие
// карточки отфильтровываются и в список не попадают.

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

/** Есть ли у мастер-класса запись — без неё прошедший не публикуется. */
function hasRecording(item: PublicMasterclass): boolean {
  return Boolean(item.recording_url || recordingFileUrl(item));
}

/** Плеер записи: встроенный для разрешённых сервисов, иначе файл или ссылка. */
function RecordingPlayer({ item }: { item: PublicMasterclass }) {
  const embed = embedUrl(item.recording_url);
  if (embed) {
    return (
      <figure className="mt-4">
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
      <figure className="mt-4">
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
      <p className="mt-3 text-sm">
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

  return null;
}

export function MasterclassesPastPage() {
  const [items, setItems] = useState<PublicMasterclass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: 'Записи прошедших мастер-классов',
    description:
      'Записи прошедших мастер-классов конкурса «Лидеры права – 2027»: просмотр прямо на сайте, краткое резюме встречи и материалы. Публикуются только встречи с записью.',
    path: '/masterclasses/past',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Мастер-классы', path: '/masterclasses' },
      { name: 'Записи прошедших', path: '/masterclasses/past' },
    ]),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await api.masterclasses({ status: 'past' });
        // Список не отдаёт адрес загруженной записи и тему: их берём из карточки
        // мастер-класса, чтобы плеер работал и были видны тема и сезон.
        const enriched = await Promise.all(
          list.map(async (item) => {
            if (item.slug && item.recording_file_url != null && item.topic != null) return item;
            try {
              const card = await api.masterclass(item.slug ?? `masterclass-${item.id}`);
              return { ...item, ...card };
            } catch {
              return item;
            }
          })
        );
        if (active) setItems(enriched);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить записи мастер-классов.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Прошедший мастер-класс без записи не публикуется (ТЗ 04, п. 3.6).
  const visible = items.filter(hasRecording);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Мастер-классы"
        title="Записи прошедших мастер-классов"
        lead="Прошедшие встречи с экспертами: запись доступна для просмотра прямо на сайте, ниже — краткое резюме и ссылка на материалы."
        actions={
          <ActionLink to="/masterclasses" variant="secondary">
            Анонсы мастер-классов
          </ActionLink>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем записи…</p>
      ) : visible.length === 0 ? (
        <Alert tone="info" title="Записей пока нет">
          Записи прошедших мастер-классов появятся здесь после встреч. Прошедший мастер-класс публикуется только при
          наличии записи, поэтому раздел наполняется по мере проведения встреч. Анонсы смотрите в разделе{' '}
          <Link to="/masterclasses" className="text-accent underline underline-offset-2">
            «Мастер-классы»
          </Link>
          .
        </Alert>
      ) : (
        <Section
          title={`Записи (${visible.length})`}
          description="Прошедший мастер-класс без записи не публикуется. Дата и время указаны по московскому времени."
        >
          <ul className="flex flex-col gap-8">
            {visible.map((item) => (
              <li key={item.id} className="border-b border-border pb-8 last:border-b-0 last:pb-0">
                <article>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="text-h3 font-semibold">
                      <Link to={`/masterclasses/${item.slug ?? `masterclass-${item.id}`}`} className="hover:text-accent">
                        {item.title}
                      </Link>
                    </h2>
                    {item.topic ? <p className="mono-label text-muted">{item.topic}</p> : null}
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {formatMoscowHuman(item.starts_at)} · {item.speaker}
                    {item.speaker_info ? `, ${item.speaker_info}` : ''}
                  </p>

                  <RecordingPlayer item={item} />

                  {item.description ? (
                    <p className="mt-4 max-w-measure text-sm">{item.description}</p>
                  ) : (
                    <p className="mt-4 text-sm text-muted">Краткое резюме встречи готовится к публикации.</p>
                  )}

                  <p className="mt-3 text-sm">
                    <Link
                      to={`/masterclasses/${item.slug ?? `masterclass-${item.id}`}`}
                      className="text-accent underline underline-offset-2"
                    >
                      Материалы и подробности мастер-класса
                    </Link>
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="max-w-measure text-sm text-muted">
        Если запись не воспроизводится, сообщите об этом через раздел{' '}
        <Link to="/contacts" className="text-accent underline underline-offset-2">
          «Контакты»
        </Link>
        — Оргкомитет проверит публикацию.
      </p>
    </main>
  );
}
