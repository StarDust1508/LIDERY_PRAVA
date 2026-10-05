import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type PublicPage, type Season, type Winner, api, formatMoscowDate, formatMoscowHuman } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, TableOfContents } from '@/components/PageBlocks';
import { useSeason } from '@/lib/season';
import { breadcrumbs, useSeo } from '@/lib/seo';

// История конкурса (ТЗ 08, п. 2.1 и 3.2): текст истории и итоги по сезонам.
//
// Итоги берутся только из опубликованных записей `winners`. Год, по которому
// данных нет, не показывается: выдумывать победителей нельзя.

const TOC_ITEMS = [
  { id: 'history', title: 'История конкурса' },
  { id: 'season', title: 'Сроки текущего сезона' },
  { id: 'seasons', title: 'Итоги по сезонам' },
];

interface SeasonRow {
  year: number;
  nominations: string;
  teams: string;
}

/** Период этапа: начало — датой, окончание — датой со временем и пометкой МСК. */
function formatPeriod(from: string | null, to: string | null): string {
  if (from && to) return `с ${formatMoscowDate(from)} до ${formatMoscowHuman(to)}`;
  if (to) return `до ${formatMoscowHuman(to)}`;
  if (from) return `с ${formatMoscowDate(from)}`;
  return '—';
}

export function HistoryPage() {
  const { data: seasonData } = useSeason();
  const season: Season | null = seasonData?.season ?? null;
  const [page, setPage] = useState<PublicPage | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: page?.seo_title ?? 'История конкурса',
    description:
      page?.seo_description ??
      'История конкурса «Лидеры\u00A0права\u00A0– 2027»: конкурс проводится с 2017 года, десятый сезон — 2026/2027, итоги прошлых сезонов по годам и номинациям.',
    path: '/about/history',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'О конкурсе', path: '/about' },
      { name: 'История конкурса', path: '/about/history' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.page('about-history');
        if (active) setPage(data);
      } catch {
        // Страница ещё не заполнена в админке — показываем текст по умолчанию.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.winners();
        if (active) setWinners(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить итоги сезонов.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Одна строка на сезон: год, номинации и команды, по которым есть публикация.
  const rows = useMemo<SeasonRow[]>(() => {
    const byYear = new Map<number, Winner[]>();
    for (const winner of winners) {
      const list = byYear.get(winner.season_year) ?? [];
      list.push(winner);
      byYear.set(winner.season_year, list);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({
        year,
        nominations: [...new Set(items.map((item) => item.nomination))].join('; ') || '—',
        teams:
          [...new Set(items.map((item) => item.team_name).filter((name): name is string => Boolean(name)))].join(
            '; '
          ) || '—',
      }));
  }, [winners]);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="О конкурсе"
        title={page?.title ?? 'История конкурса'}
        lead={
          <>
            Конкурс «Лидеры&nbsp;права» проводится с 2017 года. Текущий сезон — десятый: «Лидеры&nbsp;права&nbsp;–
            2027».
          </>
        }
        actions={<ActionLink to="/winners">Победители конкурса</ActionLink>}
      />

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        <TableOfContents items={TOC_ITEMS} />

        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <div id="history" className="scroll-mt-24">
            <SectionCard title="История конкурса" description="Как конкурс развивался с 2017 года.">
              {page?.body ? (
                <Prose>
                  <p className="whitespace-pre-line">{page.body}</p>
                </Prose>
              ) : (
                <Prose>
                  <p>
                    Конкурс «Лидеры&nbsp;права» проводится с 2017 года. Его задача — развивать законотворческую
                    культуру: команды готовят собственные законопроекты, работают с наставниками и защищают
                    инициативы перед экспертами и Жюри.
                  </p>
                  <p>
                    Текущий сезон — десятый.{season ? ` Сезон ${season.year - 1}/${season.year}.` : null} Отборочный
                    и первый этапы проходят дистанционно, второй (финальный) этап — очно в Москве.
                  </p>
                  <p>
                    Лучшие инициативы направляются субъектам права законодательной инициативы и публикуются в{' '}
                    <Link to="/initiatives" className="text-accent underline underline-offset-2">
                      архиве законопроектов
                    </Link>
                    .
                  </p>
                </Prose>
              )}
            </SectionCard>
          </div>

          <div id="season" className="scroll-mt-24">
            <SectionCard title="Сроки текущего сезона" description="Все сроки — по московскому времени.">
              {season ? (
                <>
                  <dl className="grid gap-5 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="mono-label text-muted">Приём заявок и конкурсных материалов</dt>
                      <dd className="mt-1">{formatPeriod(season.application_open_at, season.application_close_at)}</dd>
                    </div>
                    <div>
                      <dt className="mono-label text-muted">Техническая проверка</dt>
                      <dd className="mt-1">{formatPeriod(season.tech_check_from, season.tech_check_to)}</dd>
                    </div>
                    <div>
                      <dt className="mono-label text-muted">Первый этап</dt>
                      <dd className="mt-1">{formatPeriod(season.stage1_from, season.stage1_to)}</dd>
                    </div>
                    <div>
                      <dt className="mono-label text-muted">Второй (финальный) этап</dt>
                      <dd className="mt-1">{formatPeriod(season.final_from, season.final_to)}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-sm text-muted">
                    Полный календарь — в разделе{' '}
                    <Link to="/stages/calendar" className="text-accent underline underline-offset-2">
                      «Календарь»
                    </Link>
                    . Даты меняются только решением Оргкомитета, о переносе сообщается заранее.
                  </p>
                </>
              ) : (
                <p className="max-w-measure text-sm text-muted">
                  Сроки сезона ведутся в системе Оргкомитета и публикуются в разделе{' '}
                  <Link to="/stages/calendar" className="text-accent underline underline-offset-2">
                    «Календарь»
                  </Link>
                  .
                </p>
              )}
            </SectionCard>
          </div>

          <div id="seasons" className="scroll-mt-24">
            <SectionCard
              title="Итоги по сезонам"
              description="Годы, номинации и команды, опубликованные в разделе «Победители»."
            >
              {error ? <Alert tone="danger">{error}</Alert> : null}

              {loading ? (
                <p role="status">Загружаем итоги сезонов…</p>
              ) : rows.length === 0 ? (
                <Alert tone="info" title="Итоги сезонов пока не опубликованы">
                  Победители публикуются Оргкомитетом после подведения итогов и подтверждения согласий участников.
                  Годы, по которым подтверждённых данных нет, не показываются, чтобы не публиковать неточности.
                </Alert>
              ) : (
                <>
                  <ResponsiveTable
                    caption="Сезоны конкурса, номинации и команды"
                    columns={['Год', 'Номинации', 'Команды']}
                    rows={rows}
                    rowKey={(row) => row.year}
                    renderCell={(row, index) => {
                      if (index === 0) {
                        return (
                          <Link to={`/winners/${row.year}`} className="text-accent underline underline-offset-2">
                            {row.year}
                          </Link>
                        );
                      }
                      return index === 1 ? row.nominations : row.teams;
                    }}
                  />
                  <p className="mt-4 text-sm text-muted">
                    Карточки команд, участников и инициатив — в разделе{' '}
                    <Link to="/winners" className="text-accent underline underline-offset-2">
                      «Победители»
                    </Link>
                    . Фотографии и видеосюжеты публикуются только при наличии согласий.
                  </p>
                </>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </main>
  );
}
