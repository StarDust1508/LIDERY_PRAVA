import { useEffect, useMemo, useState } from 'react';
import { type PublicCriterion, EVALUATION_STAGES, api, formatMoscowDate, pluralize } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';

// Раздел «Этапы»: обзорная страница-хаб (ТЗ 08, п. 2.1 и п. 3.1).
//
// Здесь только ориентир: три этапа, общий календарь, критерии и апелляции.
// Подробности живут на отдельных страницах, поэтому на экране одна мысль и
// крупные ссылки-действия. Сроки берутся из активного сезона, критерии — из
// справочника: правки Оргкомитета в админке сразу видны на сайте.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
]);

/**
 * Редактируемый текст страницы из админки (раздел «Страницы»).
 *
 * Пока Оргкомитет не завёл строку, запрос отвечает ошибкой — тогда страница
 * показывает свой текст по умолчанию, а не пустой блок. Хелпер объявлен в
 * странице-хабе раздела: отдельный служебный модуль за пределами разрешённых
 * файлов не создаётся.
 */
export function useOrganizerText(slug: string): string | null {
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const page = await api.page(slug);
        if (active && page.body && page.body.trim() !== '') setBody(page.body);
      } catch {
        // Строки ещё нет в админке — остаётся текст по умолчанию.
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  return body;
}

/** «11 ноября 2026 года — 11 декабря 2026 года»; без данных — прочерк. */
export function formatPeriod(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '—';
  return `${formatMoscowDate(from)} — ${formatMoscowDate(to)}`;
}

export function StagesPage() {
  const { data: seasonData, error: seasonError } = useSeason();
  const season = seasonData?.season ?? null;

  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  const organizerText = useOrganizerText('stages');

  useSeo({
    title: 'Этапы конкурса',
    description:
      'Три этапа конкурса «Лидеры права – 2027»: отборочный, первый и второй (финальный) в Москве. Формат, сроки по московскому времени, календарь, критерии оценки и апелляции.',
    path: '/stages',
    jsonLd: BREADCRUMBS,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.criteria();
        if (active) setCriteria(data);
      } catch {
        if (active) setCriteriaError('Не удалось загрузить критерии оценки.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const criteriaByStage = useMemo(
    () =>
      EVALUATION_STAGES.map((stage) => {
        const items = criteria.filter((criterion) => criterion.stage === stage.value);
        const total = items.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);
        return { stage, items, total };
      }).filter((group) => group.items.length > 0),
    [criteria]
  );

  const stages = [
    {
      key: 'selection',
      format: 'Дистанционно',
      title: 'Отборочный этап',
      essence:
        'Экспертиза законотворческих инициатив: команда представляет текст законопроекта и пояснительную записку.',
      periodLabel: 'Приём заявок и конкурсных материалов',
      period: formatPeriod(season?.application_open_at, season?.application_close_at),
      path: '/stages/selection',
      action: 'Об отборочном этапе',
    },
    {
      key: 'stage1',
      format: 'Дистанционно',
      title: 'Первый этап',
      essence:
        'Онлайн-предзащита инициативы перед Конкурсной комиссией и экспертами, затем видеоролик во «ВКонтакте» (с учётом мнения комиссии) и оценка конкурсных материалов.',
      periodLabel: 'Этап проходит',
      period: formatPeriod(season?.stage1_from, season?.stage1_to),
      path: '/stages/first',
      action: 'О первом этапе',
    },
    {
      key: 'final',
      format: 'Очно, Москва',
      title: 'Второй (финальный) этап',
      essence: 'Групповые выступления команд, дебаты, Гранд-финал с голосованием зала и награждение.',
      periodLabel: 'Этап проходит',
      period: formatPeriod(season?.final_from, season?.final_to),
      path: '/stages/final',
      action: 'О втором (финальном) этапе',
    },
  ];

  const appealWindow = season
    ? `${pluralize(season.appeal_window_days, ['рабочий день', 'рабочих дня', 'рабочих дней'])} с момента опубликования протокола этапа`
    : 'срок, установленный Положением о конкурсе';

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Этапы конкурса"
        lead={
          <>
            Конкурс «Лидеры&nbsp;права&nbsp;– 2027» проводится в три этапа. Отборочный и первый этапы — дистанционно,
            второй (финальный) — очно в Москве. Все сроки указываются по московскому времени.
          </>
        }
        actions={
          <>
            {season?.is_application_open ? <ActionLink to="/apply">Подать заявку</ActionLink> : null}
            <ActionLink to="/stages/calendar" variant="secondary">
              Календарь этапов
            </ActionLink>
          </>
        }
      />

      {seasonError ? <Alert tone="warning">Не удалось загрузить сроки активного сезона. Повторить запрос можно на странице календаря.</Alert> : null}

      <ol className="grid gap-4 md:grid-cols-3">
        {stages.map((stage) => (
          <li key={stage.key} className="flex flex-col gap-3 border border-border bg-raised p-5">
            <p className="mono-label text-muted">{stage.format}</p>
            <h2 className="text-h3 font-semibold">{stage.title}</h2>
            <p className="text-sm text-muted">{stage.essence}</p>
            <dl className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-sm">
              <dt className="mono-label text-muted">{stage.periodLabel}</dt>
              <dd className="mt-1">{stage.period}</dd>
            </dl>
            <div>
              <ActionLink to={stage.path} variant="secondary">
                {stage.action}
              </ActionLink>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-4 border border-border bg-raised px-5 py-4">
        <div>
          <p className="mono-label text-muted">Общий календарь</p>
          <p className="mt-1 max-w-measure text-sm text-muted">
            Приём заявок, техническая проверка, этапы и подача апелляций — единым списком. Все даты — по московскому
            времени (МСК, UTC+3).
          </p>
        </div>
        <ActionLink to="/stages/calendar" variant="secondary">
          Календарь этапов
        </ActionLink>
      </div>

      <Section
        title="Критерии оценки"
        description="Раздел 10 Положения: у каждого этапа свои критерии и максимум баллов."
      >
        {criteriaError ? <Alert tone="warning">{criteriaError}</Alert> : null}
        {criteriaByStage.length === 0 ? (
          <p className="text-sm text-muted">Критерии загружаются…</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {criteriaByStage.map(({ stage, items, total }) => (
              <li
                key={stage.value}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-2"
              >
                <span>{stage.title}</span>
                <span className="font-mono">
                  {pluralize(items.length, ['критерий', 'критерия', 'критериев'])} · максимум {total} баллов
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5">
          <ActionLink to="/stages/criteria" variant="secondary">
            Критерии по этапам
          </ActionLink>
        </div>
      </Section>

      <Section
        title="Апелляции"
        description="Итоги отборочного и первого этапов можно обжаловать; решения второго (финального) этапа — нет."
      >
        <Prose>
          <p>
            Апелляцию подаёт капитан команды через личный кабинет: {appealWindow}. Основания и порядок подачи собраны
            на отдельной странице.
          </p>
        </Prose>
        <div className="mt-5">
          <ActionLink to="/stages/appeals" variant="secondary">
            Порядок подачи апелляции
          </ActionLink>
        </div>
      </Section>

      {organizerText ? (
        <Section title="От Оргкомитета" description="Дополнительные сведения, опубликованные Оргкомитетом.">
          <Prose>
            <p className="whitespace-pre-line">{organizerText}</p>
          </Prose>
        </Section>
      ) : null}
    </main>
  );
}
