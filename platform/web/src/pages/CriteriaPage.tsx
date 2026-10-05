import { useEffect, useMemo, useState } from 'react';
import { type PublicCriterion, EVALUATION_STAGES, api, pluralize } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, TableOfContents } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useOrganizerText } from './StagesPage';

// Критерии оценки по этапам (ТЗ 02, п. 6; ТЗ 08, п. 2.1 и 3.2).
//
// Критерии и максимумы баллов берутся из справочника criteria, суммы считаются
// из данных: ни число критериев, ни итог в коде не закреплены. Оглавление ведёт
// по якорям этапов, чтобы ссылку на нужный раздел можно было переслать.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
  { name: 'Критерии оценки', path: '/stages/criteria' },
]);

const RULES = [
  'Каждую инициативу на отборочном и первом этапах оценивают не менее трёх членов Конкурсной комиссии независимо друг от друга.',
  'Итоговый балл этапа — среднее арифметическое сумм баллов членов Конкурсной комиссии с округлением до сотых.',
  'Если суммы баллов членов комиссии расходятся более чем на 20 баллов, материалы направляются на дополнительную оценку председателя Конкурсной комиссии; его балл учитывается при расчёте среднего.',
  'На втором (финальном) этапе итог дебатов — сумма баллов всех членов Жюри.',
  'Рейтинг команд — ранжированный по убыванию баллов список.',
  'При равенстве баллов на первом этапе преимущество у команды с более высоким баллом отборочного этапа; на дебатах — по критерию «Убедительность и эффективность доводов в защиту проекта», далее — по голосу председателя Жюри.',
];

const RULES_ANCHOR = 'criteria-rules';

export function CriteriaPage() {
  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const organizerText = useOrganizerText('criteria');

  useSeo({
    title: 'Критерии оценки',
    description:
      'Критерии оценки конкурса «Лидеры права – 2027» по трём этапам: отборочный — 70 баллов, первый — 80 баллов, дебаты второго (финального) этапа — 45 баллов, и правила подсчёта итоговых баллов.',
    path: '/stages/criteria',
    jsonLd: BREADCRUMBS,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.criteria();
        if (active) setCriteria(data);
      } catch {
        if (active) setError('Не удалось загрузить критерии оценки.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(
    () =>
      EVALUATION_STAGES.map((stage) => {
        const items = criteria.filter((criterion) => criterion.stage === stage.value);
        const total = items.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);
        return { stage, items, total, anchor: `criteria-${stage.value}` };
      }).filter((group) => group.items.length > 0),
    [criteria]
  );

  const tocItems = [
    ...groups.map((group) => ({ id: group.anchor, title: group.stage.title })),
    { id: RULES_ANCHOR, title: 'Правила подсчёта' },
  ];

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Критерии оценки"
        lead={
          <>
            Раздел 10 Положения: по каждому этапу свои критерии и максимум баллов. Каждый критерий оценивается по шкале
            от 0 до 10: 0 — не отражён, 1–3 — фрагментарно, 4–6 — достаточно, 7–9 — полно, 10 — образцово.
          </>
        }
        actions={
          <>
            <ActionLink to="/stages/appeals" variant="secondary">
              Апелляции
            </ActionLink>
            <ActionLink to="/documents" variant="secondary">
              Положение и приложения
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      {criteria.length === 0 ? (
        <p className="text-sm text-muted">Критерии загружаются…</p>
      ) : (
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-10">
          <TableOfContents items={tocItems} />

          <div className="flex flex-col gap-8">
            {groups.map(({ stage, items, total, anchor }) => (
              <div key={stage.value} id={anchor} className="scroll-mt-24">
                <SectionCard
                  title={stage.title}
                  description={
                    stage.value === 'debate'
                      ? `Пункт 10.4 Положения. Итого по этапу — ${pluralize(total, ['балл', 'балла', 'баллов'])} при оценке всеми членами Жюри.`
                      : `Пункт 10.${stage.value === 'selection' ? '2' : '3'} Положения. Итого по этапу — ${pluralize(total, ['балл', 'балла', 'баллов'])} от одного члена Конкурсной комиссии.`
                  }
                >
                  <ResponsiveTable
                    caption={`Критерии: ${stage.title}`}
                    columns={['Критерий', 'Максимум баллов']}
                    rows={items}
                    rowKey={(row) => row.id}
                    renderCell={(row, index) =>
                      index === 0 ? (
                        <>
                          <span className="mono-label text-muted">{row.code}</span>
                          <span className="mt-1 block">{row.title}</span>
                          {row.description ? <span className="mt-1 block text-muted">{row.description}</span> : null}
                        </>
                      ) : (
                        <span className="font-mono">{Number(row.max_score)}</span>
                      )
                    }
                  />
                  <p className="mt-4 text-sm">
                    Итого: <strong>{pluralize(total, ['балл', 'балла', 'баллов'])}</strong>.
                  </p>
                </SectionCard>
              </div>
            ))}

            <div id={RULES_ANCHOR} className="scroll-mt-24">
              <SectionCard
                title="Правила подсчёта"
                description="Пункты 7.7, 8.5 и 9.4.2 Положения: как из оценок получается итоговый балл."
              >
                <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
                  {RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ol>
                <Prose>
                  <p className="mt-4 text-sm text-muted">
                    Оценочный лист формируется по критериям этапа из справочника, а не по числу строк печатного бланка
                    (Приложение № 9), поэтому состав критериев и подсчёт всегда совпадают.
                  </p>
                </Prose>
              </SectionCard>
            </div>
          </div>
        </div>
      )}

      {organizerText ? (
        <SectionCard title="От Оргкомитета" description="Дополнительные сведения, опубликованные Оргкомитетом.">
          <Prose>
            <p className="whitespace-pre-line">{organizerText}</p>
          </Prose>
        </SectionCard>
      ) : null}
    </main>
  );
}
