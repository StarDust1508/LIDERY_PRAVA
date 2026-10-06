import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, type Winner, api, formatMoscowHuman } from '@shared/index';
import { Alert } from '@shared/index';
import { Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Победители по годам и номинациям (ТЗ 08, п. 5). Публикуются только записи,
// открытые Оргкомитетом; фото — при наличии согласия, иначе выводится заглушка.

const PLACE_TITLES: Record<number, string> = { 1: 'I место', 2: 'II место', 3: 'III место' };

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
        {!year && years.length > 0 ? (
          <nav aria-label="Годы конкурса" className="mt-4 flex flex-wrap gap-3 text-sm">
            {years.map((value) => (
              <Link key={value} to={`/winners/${value}`} className="text-accent underline underline-offset-2">
                {value}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем список…</p>
      ) : winners.length === 0 ? (
        <Alert tone="info" title="Список пока не опубликован">
          Победители публикуются Оргкомитетом после подведения итогов сезона. Итоги прошлых лет вносятся вручную и
          появятся по мере подтверждения согласий участников.
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
                      className="flex h-32 w-32 items-center justify-center border border-border bg-surface text-sm text-muted"
                      role="img"
                      aria-label="Фотография не опубликована"
                    >
                      фото не опубликовано
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
