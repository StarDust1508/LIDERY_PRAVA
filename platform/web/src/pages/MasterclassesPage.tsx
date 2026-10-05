import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, type PublicMasterclass, api, formatMoscowHuman } from '@shared/index';
import { Alert, Button, SectionCard, SelectField } from '@shared/index';
import { ActionLink, PageHeader } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Мастер-классы: анонсы (ТЗ 08, п. 2.1 и 4).
//
// Фильтры по сезону, спикеру и теме работают на клиенте по загруженному списку,
// а значения хранятся в адресной строке: ссылку на подборку можно переслать.
// Прошедший мастер-класс без записи не публикуется — такие записи не попадают
// ни в список, ни в счётчики.

/** Адрес карточки: человекочитаемый slug, а для старых записей — служебный. */
function cardPath(item: PublicMasterclass): string {
  return `/masterclasses/${item.slug ?? `masterclass-${item.id}`}`;
}

/** Есть ли у мастер-класса запись: ссылка на сервис или загруженный файл. */
function hasRecording(item: PublicMasterclass): boolean {
  return Boolean(item.recording_url || item.recording_file_url || item.media_id);
}

export function MasterclassesPage() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<PublicMasterclass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const season = params.get('season') ?? '';
  const speaker = params.get('speaker') ?? '';
  const topic = params.get('topic') ?? '';

  useSeo({
    title: 'Мастер-классы',
    description:
      'Мастер-классы конкурса «Лидеры права – 2027»: анонсы встреч с экспертами для команд-финалистов, дата и время по Москве, спикер и тема. Записи прошедших доступны на сайте.',
    path: '/masterclasses',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Мастер-классы', path: '/masterclasses' },
    ]),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await api.masterclasses();
        // Список не отдаёт тему и сезон, поэтому недостающие поля берутся из
        // карточки мастер-класса: без них фильтры по сезону и теме были бы
        // пустыми. Если список начнёт отдавать эти поля сам, запросы не нужны.
        const enriched = await Promise.all(
          list.map(async (item) => {
            if (item.slug && item.topic != null && item.season_slug != null) return item;
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
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить мастер-классы.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const seasonOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.season_slug) map.set(item.season_slug, item.season_title ?? item.season_slug);
    }
    return [...map.entries()].map(([value, title]) => ({ value, title }));
  }, [items]);

  const speakerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) if (item.speaker) set.add(item.speaker);
    return [...set].sort((a, b) => a.localeCompare(b, 'ru')).map((value) => ({ value, title: value }));
  }, [items]);

  const topicOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) if (item.topic) set.add(item.topic);
    return [...set].sort((a, b) => a.localeCompare(b, 'ru')).map((value) => ({ value, title: value }));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (season === '' || item.season_slug === season) &&
          (speaker === '' || item.speaker === speaker) &&
          (topic === '' || item.topic === topic)
      ),
    [items, season, speaker, topic]
  );

  const announced = filtered.filter((item) => item.status === 'announced');
  const pastWithRecording = filtered.filter((item) => item.status === 'past' && hasRecording(item));
  const filtersActive = season !== '' || speaker !== '' || topic !== '';

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Обучение"
        title="Мастер-классы"
        lead="Встречи с экспертами для команд-финалистов: юридическая техника, работа с экспертизой и подготовка к дебатам. Дата и время указаны по московскому времени."
        actions={
          <ActionLink to="/masterclasses/past" variant="secondary">
            Записи прошедших
          </ActionLink>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard
        title="Фильтры"
        description="Отбор по сезону, спикеру и теме. Выбранные фильтры сохраняются в адресной строке."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            id="masterclasses-season"
            label="Сезон"
            value={season}
            onChange={(event) => update('season', event.target.value)}
            placeholder="Все сезоны"
            options={seasonOptions}
            disabled={seasonOptions.length === 0}
            hint={seasonOptions.length === 0 ? 'Сезоны появятся, когда Оргкомитет заполнит расписание.' : undefined}
          />
          <SelectField
            id="masterclasses-speaker"
            label="Спикер"
            value={speaker}
            onChange={(event) => update('speaker', event.target.value)}
            placeholder="Все спикеры"
            options={speakerOptions}
            disabled={speakerOptions.length === 0}
          />
          <SelectField
            id="masterclasses-topic"
            label="Тема"
            value={topic}
            onChange={(event) => update('topic', event.target.value)}
            placeholder="Все темы"
            options={topicOptions}
            disabled={topicOptions.length === 0}
            hint={topicOptions.length === 0 ? 'Темы появятся, когда Оргкомитет заполнит расписание.' : undefined}
          />
        </div>
        {filtersActive ? (
          <p className="mt-4">
            <Button type="button" variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Сбросить фильтры
            </Button>
          </p>
        ) : null}
      </SectionCard>

      {loading ? (
        <p role="status">Загружаем мастер-классы…</p>
      ) : (
        <>
          <SectionCard
            title={`Анонсы (${announced.length})`}
            description="Что будет на встрече, кто ведёт и как подключиться."
          >
            {announced.length === 0 ? (
              <p className="text-sm text-muted">
                {filtersActive
                  ? 'По выбранным фильтрам анонсов нет. Сбросьте фильтры или посмотрите записи прошедших мастер-классов.'
                  : 'Анонсы появятся после утверждения расписания Оргкомитетом.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-6">
                {announced.map((item) => (
                  <li key={item.id} className="border border-border p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h3 className="text-h3 font-semibold">
                        <Link to={cardPath(item)} className="hover:text-accent">
                          {item.title}
                        </Link>
                      </h3>
                      {item.topic ? <p className="mono-label text-muted">{item.topic}</p> : null}
                    </div>
                    <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
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
                      <div>
                        <dt className="mono-label text-muted">Место и формат</dt>
                        <dd className="mt-1">{item.place ?? 'формат уточняется'}</dd>
                      </div>
                      {item.season_title ? (
                        <div>
                          <dt className="mono-label text-muted">Сезон</dt>
                          <dd className="mt-1">{item.season_title}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {item.description ? <p className="mt-3 max-w-measure text-sm">{item.description}</p> : null}
                    <p className="mt-4 text-sm text-muted">Напоминание придёт после подключения рассылки.</p>
                    <p className="mt-3 text-sm">
                      <Link to={cardPath(item)} className="text-accent underline underline-offset-2">
                        Подробнее о мастер-классе
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title={`Записи прошедших (${pastWithRecording.length})`}
            description="Прошедший мастер-класс публикуется только при наличии записи: её можно посмотреть прямо на сайте."
          >
            <p className="max-w-measure text-sm text-muted">
              {pastWithRecording.length === 0
                ? filtersActive
                  ? 'По выбранным фильтрам записей нет. Сбросьте фильтры или откройте все записи прошедших.'
                  : 'Записей пока нет.'
                : 'Записи прошедших мастер-классов собраны на отдельной странице вместе с плеером и материалами встречи.'}
            </p>
            <p className="mt-4">
              <ActionLink to="/masterclasses/past" variant="secondary">
                Записи прошедших мастер-классов
              </ActionLink>
            </p>
          </SectionCard>

          <p className="max-w-measure text-sm text-muted">
            Пока рассылка не подключена, о датах и изменениях Оргкомитет сообщает на этой странице и в сообществе во
            «ВКонтакте». Вопрос о мастер-классе можно задать через раздел{' '}
            <Link to="/contacts" className="text-accent underline underline-offset-2">
              «Контакты»
            </Link>
            .
          </p>
        </>
      )}
    </main>
  );
}
