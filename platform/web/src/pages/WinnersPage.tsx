import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, type Winner, api, formatMoscowHuman } from '@shared/index';
import { Alert } from '@shared/index';
import { Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Победители по годам и номинациям (ТЗ 08, п. 5). Публикуются только записи,
// открытые Оргкомитетом; фото — при наличии согласия, иначе выводится заглушка.


/** Монограмма команды для карточки без фотографии: до двух первых букв слов. */
function monogram(teamName: string | null): string {
  const words = (teamName ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || 'ЛП';
}

const PLACE_TITLES: Record<number, string> = { 1: 'I место', 2: 'II место', 3: 'III место' };

/** Годы, для которых есть кадр в /assets/history (присланы заказчиком 23.10.2026). */
const ALL_YEARS = [2018, 2021, 2023, 2026];

const YEAR_PHOTOS: Record<number, string> = {
  2018: '/assets/history/history-2018.jpg',
  2021: '/assets/history/history-2021.jpg',
  2023: '/assets/history/history-2023.jpg',
  2026: '/assets/history/history-2026.jpg',
};



export function WinnersPage() {
  const params = useParams();
  const year = params.year ? Number(params.year) : undefined;
  const [winners, setWinners] = useState<Winner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: year ? `Победители ${year} года` : 'Победители конкурса',
    description:
      'Победители и призёры конкурса «Лидеры права» по годам и номинациям: команды, участники, законопроекты и видеосюжеты.',
    path: year ? `/winners/${year}` : '/winners',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Победители', path: '/winners' },
    ]),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await api.winners(year);
        if (active) setWinners(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить список победителей.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [year]);

  const years = useMemo(
    () => [...new Set(winners.map((winner) => winner.season_year))].sort((a, b) => b - a),
    [winners]
  );
  const byNomination = useMemo(() => {
    const map = new Map<string, Winner[]>();
    for (const winner of winners) {
      const list = map.get(winner.nomination) ?? [];
      list.push(winner);
      map.set(winner.nomination, list);
    }
    return [...map.entries()];
  }, [winners]);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">История конкурса</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">
          {year ? `Победители ${year} года` : 'Победители'}
        </h1>
        <p className="mt-3 max-w-measure text-muted">
          Команды и номинации по годам. Фотографии и видеосюжеты публикуются только при наличии согласий участников и
          законных представителей.
        </p>
        <nav aria-label="Годы конкурса" className="mt-4 flex flex-wrap gap-3 text-sm">
          {[...new Set([...years, ...ALL_YEARS])]
            .sort((a, b) => b - a)
            .map((value) => (
              <Link
                key={value}
                to={`/winners/${value}`}
                aria-current={year === value ? 'page' : undefined}
                className={
                  year === value
                    ? 'border border-accent px-3 py-1 text-accent'
                    : 'border border-border px-3 py-1 text-accent hover:border-accent'
                }
              >
                {value}
              </Link>
            ))}
        </nav>
        {year && YEAR_PHOTOS[year] ? (
          <figure className="mt-6">
            <img
              src={YEAR_PHOTOS[year]!}
              alt={`Участники и организаторы конкурса «Лидеры права» в ${year} году`}
              className="w-full max-w-3xl border border-border object-cover"
              loading="lazy"
            />
            <figcaption className="mt-2 text-sm text-muted">
              Кадр конкурса {year} года. Команды-победители — ниже.
            </figcaption>
          </figure>
        ) : null}
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем список…</p>
      ) : winners.length === 0 ? (
        <Alert tone="info" title={year ? `Итоги ${year} года ещё не внесены` : 'Список пока не опубликован'}>
          Победители публикуются Оргкомитетом после подведения итогов сезона. Итоги прошлых лет вносятся вручную —
          выберите год выше.{' '}
          <Link to="/about/history" className="text-accent underline underline-offset-2">
            История проекта по годам
          </Link>
          .
        </Alert>
      ) : (
        byNomination.map(([nomination, items]) => (
          <Section key={nomination} title={nomination}>
            <ul className="flex flex-col gap-6">
              {items.map((winner) => (
                <li key={winner.id} className="flex flex-wrap gap-5 border-b border-border pb-5">
                  {winner.photo_url ? (
                    <img
                      src={winner.photo_url}
                      alt={`Фото команды ${winner.team_name ?? ''}`.trim()}
                      className="h-32 w-32 border border-border object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="winner-monogram-card"
                      role="img"
                      aria-label={`Фотография команды ${winner.team_name ?? ''} готовится к публикации`}
                    >
                      <span className="winner-monogram" aria-hidden="true">
                        {monogram(winner.team_name)}
                      </span>
                      <span className="winner-monogram-year" aria-hidden="true">
                        {winner.season_year}
                      </span>
                    </div>
                  )}
                  <div className="min-w-[240px] flex-1">
                    <p className="mono-label text-muted">
                      {winner.season_year} · {winner.place ? PLACE_TITLES[winner.place] ?? `${winner.place} место` : nomination}
                    </p>
                    <h3 className="mt-1 text-h3 font-semibold">{winner.team_name ?? 'Команда'}</h3>
                    {winner.initiative_title ? (
                      <p className="mt-1 text-sm">
                        Инициатива:{' '}
                        <Link to={`/initiatives?q=${encodeURIComponent(winner.initiative_title)}`} className="text-accent underline underline-offset-2">
                          {winner.initiative_title}
                        </Link>
                      </p>
                    ) : null}
                    {winner.participants_text ? (
                      <p className="mt-1 text-sm text-muted">{winner.participants_text}</p>
                    ) : null}
                    {winner.mentors_text ? (
                      <p className="mt-1 text-sm text-muted">Наставники: {winner.mentors_text}</p>
                    ) : null}
                    {winner.announcement ? <p className="mt-2 text-sm">{winner.announcement}</p> : null}
                    {winner.video_url ? (
                      <p className="mt-2 text-sm">
                        <a className="text-accent underline underline-offset-2" href={winner.video_url} target="_blank" rel="noopener noreferrer">
                          Видеосюжет
                        </a>
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}

      <p className="text-sm text-muted">
        Итоги финального этапа публикуются протоколом; срок подачи апелляций отсчитывается от даты публикации протокола
        (п. 12.1 Положения). Последнее обновление страницы: {formatMoscowHuman(new Date())}.
      </p>
    </main>
  );
}
