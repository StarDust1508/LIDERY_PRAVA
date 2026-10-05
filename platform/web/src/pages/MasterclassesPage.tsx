import { useEffect, useState } from 'react';
import { ApiError, type PublicMasterclass, api, formatMoscowHuman } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Мастер-классы (ТЗ 08, п. 4): анонсы и записи прошедших.
// Прошедший мастер-класс без записи не публикуется — это правило проверяется
// и на сервере при создании и изменении записи, здесь оно лишь соблюдается.

export function MasterclassesPage() {
  const [items, setItems] = useState<PublicMasterclass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: 'Мастер-классы',
    description:
      'Мастер-классы для команд-финалистов конкурса «Лидеры права – 2027»: анонсы с датой и временем по Москве и записи прошедших встреч для просмотра на сайте.',
    path: '/masterclasses',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Мастер-классы', path: '/masterclasses' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.masterclasses();
        if (active) setItems(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить мастер-классы.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const announced = items.filter((item) => item.status === 'announced');
  const past = items.filter((item) => item.status === 'past' && (item.recording_url || item.media_id));

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Обучение</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Мастер-классы</h1>
        <p className="mt-3 max-w-measure text-muted">
          Встречи с экспертами для команд-финалистов: юридическая техника, работа с экспертизой и подготовка к дебатам.
          Записи прошедших мастер-классов доступны для просмотра на сайте.
        </p>
      </header>

      {error ? <Alert tone="warning">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем мастер-классы…</p>
      ) : (
        <>
          <SectionCard title={`Анонсы (${announced.length})`} description="Дата и время указаны по московскому времени.">
            {announced.length === 0 ? (
              <p className="text-sm text-muted">Анонсы появятся после утверждения расписания Оргкомитетом.</p>
            ) : (
              <ul className="flex flex-col gap-5">
                {announced.map((item) => (
                  <li key={item.id} className="border-b border-border pb-4">
                    <h3 className="text-h3 font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {item.speaker}
                      {item.speaker_info ? ` · ${item.speaker_info}` : ''}
                    </p>
                    <p className="mt-1 text-sm">
                      {formatMoscowHuman(item.starts_at)}
                      {item.place ? ` · ${item.place}` : ''}
                    </p>
                    {item.description ? <p className="mt-2 max-w-measure text-sm">{item.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={`Записи прошедших (${past.length})`} description="Прошедший мастер-класс публикуется только при наличии записи.">
            {past.length === 0 ? (
              <p className="text-sm text-muted">Записей пока нет.</p>
            ) : (
              <ul className="flex flex-col gap-5">
                {past.map((item) => (
                  <li key={item.id} className="border-b border-border pb-4">
                    <h3 className="text-h3 font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {item.speaker} · {formatMoscowHuman(item.starts_at)}
                    </p>
                    {item.description ? <p className="mt-2 max-w-measure text-sm">{item.description}</p> : null}
                    {item.recording_url ? (
                      <p className="mt-2 text-sm">
                        <a
                          className="text-accent underline underline-offset-2"
                          href={item.recording_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Смотреть запись
                        </a>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </main>
  );
}
