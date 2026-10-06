import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, type InitiativeCard, actLevelTitle, api } from '@shared/index';
import { Alert } from '@shared/index';
import { Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Карточка инициативы. Авторы и файлы приходят с сервера только при наличии
// согласий (Приложения № 12 и № 13) — интерфейс ничего не досочиняет: если
// массив пуст, значит публикация обезличена.

export function InitiativePage() {
  const params = useParams();
  const slug = params.slug ?? '';
  const [card, setCard] = useState<InitiativeCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: card?.title ?? 'Инициатива',
    description:
      card?.annotation?.slice(0, 300) ??
      'Карточка законотворческой инициативы из архива конкурса «Лидеры права – 2027».',
    path: `/initiatives/${slug}`,
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Архив законопроектов', path: '/initiatives' },
      { name: card?.title ?? 'Инициатива', path: `/initiatives/${slug}` },
    ]),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await api.initiative(slug);
        if (active) setCard(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить инициативу.');
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
      <main className="mx-auto max-w-container px-6 py-12">
        <p role="status">Загружаем инициативу…</p>
      </main>
    );
  }

  if (!card) {
    return (
      <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-12">
        <Alert tone="warning" title="Инициатива не найдена">
          {error ?? 'Возможно, карточка снята с публикации или адрес указан с опечаткой.'}
        </Alert>
        <Link to="/initiatives" className="text-accent underline underline-offset-2">
          Вернуться в архив
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <nav aria-label="Хлебные крошки" className="mono-label text-muted">
        <Link to="/" className="hover:text-accent">
          Главная
        </Link>{' '}
        ·{' '}
        <Link to="/initiatives" className="hover:text-accent">
          Архив законопроектов
        </Link>
      </nav>

      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">
          {card.archive_year ?? '—'} · {card.direction_title ?? 'направление не указано'}
        </p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">{card.title}</h1>
        {card.annotation ? <p className="mt-4 max-w-measure text-lead">{card.annotation}</p> : null}
      </header>

      <dl className="grid gap-6 text-sm md:grid-cols-2">
        <div>
          <dt className="mono-label text-muted">Уровень акта</dt>
          <dd className="mt-1">{actLevelTitle(card.act_level)}</dd>
        </div>
        <div>
          <dt className="mono-label text-muted">Предполагаемый субъект права законодательной инициативы</dt>
          <dd className="mt-1">{card.proposed_initiator ?? 'не указан'}</dd>
        </div>
        <div>
          <dt className="mono-label text-muted">Команда</dt>
          <dd className="mt-1">{card.team_name ?? 'не указана'}</dd>
        </div>
        <div>
          <dt className="mono-label text-muted">Результат участия</dt>
          <dd className="mt-1">
            {card.result_place ? `${card.result_place} место` : card.nomination ?? 'не указан'}
          </dd>
        </div>
      </dl>

      <Section
        title={`Авторы (${card.authors.length})`}
        description="Указываются только при согласии участников на распространение персональных данных."
      >
        {card.authors.length === 0 ? (
          <p className="text-sm text-muted">
            Авторы не раскрываются: согласие на распространение персональных данных не предоставлено.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {card.authors.map((author) => (
              <li key={author.full_name} className="border-b border-border pb-2">
                {author.full_name}
                {author.organization ? ` · ${author.organization}` : ''}
                {author.region ? ` · ${author.region}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={`Конкурсные материалы (${card.files.length})`}
        description="Публикуются только при предоставлении лицензии на использование материалов."
      >
        {card.files.length === 0 ? (
          <p className="text-sm text-muted">
            Файлы работ не опубликованы: лицензия на использование конкурсных материалов не предоставлена.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {card.files.map((file) => (
              <li key={file.kind}>
                <a
                  className="text-accent underline underline-offset-2"
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {file.title}
                </a>
              </li>
            ))}
          </ul>
        )}
        {card.video_url ? (
          <p className="mt-4 text-sm">
            Видеопрезентация:{' '}
            <a className="text-accent underline underline-offset-2" href={card.video_url} target="_blank" rel="noopener noreferrer">
              публикация во «ВКонтакте»
            </a>
          </p>
        ) : null}
      </Section>

      {card.related.length > 0 ? (
        <Section title="Другие инициативы направления" description="Похожие темы из архива.">
          <ul className="flex flex-col gap-2 text-sm">
            {card.related.map((item) => (
              <li key={item.slug}>
                <Link to={`/initiatives/${item.slug}`} className="text-accent underline underline-offset-2">
                  {item.title}
                </Link>
                {item.archive_year ? <span className="text-muted"> · {item.archive_year}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </main>
  );
}
