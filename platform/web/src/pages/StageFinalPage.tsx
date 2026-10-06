import { useEffect, useState } from 'react';
import {
  type MaterialRequirement,
  type PublicCriterion,
  api,
  formatMoscowDate,
  pluralize,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';
import { formatPeriod, useOrganizerText } from './StagesPage';

// Второй (финальный) этап (ТЗ 02, п. 3, 5.3 и 6.3; ТЗ 08, п. 2.1).
//
// Этап проходит очно в Москве. Срок подтверждения участия и состав материалов
// берутся из material_requirements('final'), критерии дебатов — из справочника
// criteria, поэтому ни число дней, ни сумма баллов в коде не хранятся.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
  { name: 'Второй (финальный) этап', path: '/stages/final' },
]);

export function StageFinalPage() {
  const { data: seasonData } = useSeason();
  const season = seasonData?.season ?? null;

  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [requirements, setRequirements] = useState<MaterialRequirement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const organizerText = useOrganizerText('stage-final');

  useSeo({
    title: 'Второй (финальный) этап',
    description:
      'Второй (финальный) этап конкурса «Лидеры права – 2027»: очно в Москве, групповые выступления по три команды, дебаты на 45 баллов, Гранд-финал с голосованием зала и награждение.',
    path: '/stages/final',
    jsonLd: BREADCRUMBS,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [criteriaData, requirementsData] = await Promise.all([
          api.criteria('debate'),
          api.materialRequirements('final'),
        ]);
        if (!active) return;
        setCriteria(criteriaData);
        setRequirements(requirementsData.requirements);
      } catch {
        if (active) setError('Не удалось загрузить критерии дебатов и состав материалов финала.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const totalScore = criteria.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);
  const confirmation = requirements.find((item) => item.type === 'presentation') ?? null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Второй (финальный) этап"
        lead={
          <>
            Этап проходит очно в Москве. Команды-финалисты выступают группами, участвуют в дебатах, а победитель
            определяется в Гранд-финале голосованием Жюри и зала.
          </>
        }
        actions={
          <>
            <ActionLink to="/cabinet/final">Личный кабинет финалиста</ActionLink>
            <ActionLink to="/stages/criteria" variant="secondary">
              Критерии оценки
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <Section title="Формат и сроки" description="Все даты — по московскому времени (МСК, UTC+3).">
        {season ? (
          <ul className="flex flex-col gap-4 text-sm">
            <li>
              <p className="mono-label text-muted">Второй (финальный) этап</p>
              <p className="mt-1">{formatPeriod(season.final_from, season.final_to)}</p>
              <p className="mt-1 text-muted">
                Место проведения — Москва; участие очное. Точные адрес и расписание Оргкомитет сообщает финалистам в
                личном кабинете.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Подтверждение участия</p>
              <p className="mt-1 text-muted">
                {confirmation?.due_at
                  ? `Окончательный состав выступающих подтверждается в личном кабинете, презентационные материалы представляются не позднее ${formatMoscowDate(confirmation.due_at)}.`
                  : 'Окончательный состав выступающих подтверждается в личном кабинете не позднее чем за семь календарных дней до начала этапа.'}
              </p>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Сроки загружаются. Действующие даты собраны на странице «Календарь конкурса».
          </p>
        )}
        <div className="mt-5">
          <ActionLink to="/stages/calendar" variant="secondary">
            Календарь конкурса
          </ActionLink>
        </div>
      </Section>

      <Section
        title="Как проходит этап"
        description="Пункт 9.3 Положения: групповые выступления, дебаты, Гранд-финал и награждение."
      >
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>
            Групповые выступления команд: команды распределяются по группам по три команды. Если число финалистов не
            кратно трём, состав групп определяет Оргкомитет.
          </li>
          <li>
            Дебаты: команды защищают свои законотворческие инициативы и отвечают на вопросы оппонентов, Жюри и
            Экспертов. Максимум за дебаты — {pluralize(totalScore, ['балл', 'балла', 'баллов'])}.
          </li>
          <li>
            Гранд-финал: голосование Жюри и зала, подсчёт голосов ведёт Счётная группа. При равенстве баллов преимущество
            определяется по критерию «Убедительность и эффективность доводов», далее — голосом председателя Жюри.
          </li>
          <li>
            Награждение: объявление победителей в номинациях «Лидеры права», «Наставник Лидеров права» и «Лучший
            оратор».
          </li>
        </ol>
      </Section>

      <Section
        title="Критерии дебатов"
        description="Пункт 10.4 Положения. Итог дебатов — сумма баллов всех членов Жюри."
      >
        {criteria.length === 0 ? (
          <p className="text-sm text-muted">Критерии загружаются…</p>
        ) : (
          <>
            <ResponsiveTable
              caption="Критерии дебатов финального этапа и максимум баллов"
              columns={['Критерий', 'Максимум баллов']}
              rows={criteria}
              rowKey={(row) => row.id}
              renderCell={(row, index) =>
                index === 0 ? (
                  <>
                    <span>{row.title}</span>
                    {row.description ? <span className="mt-1 block text-muted">{row.description}</span> : null}
                  </>
                ) : (
                  <span className="font-mono">{Number(row.max_score)}</span>
                )
              }
            />
            <p className="mt-4 text-sm">
              Итого: <strong>{pluralize(totalScore, ['балл', 'балла', 'баллов'])}</strong>. Критерии оцениваются по шкале
              от 0 до 10, соблюдение регламента дебатов — от 0 до 5.
            </p>
          </>
        )}
      </Section>

      <Section
        title="Подготовка к финалу"
        description="Пункт 9.2 Положения: презентационные материалы и подтверждение статуса участника."
      >
        {requirements.length === 0 ? (
          <p className="text-sm text-muted">Состав материалов загружается…</p>
        ) : (
          <ul className="flex flex-col gap-4 text-sm">
            {requirements.map((item) => (
              <li key={item.type} className="border-b border-border pb-3">
                <p className="font-medium">{item.title}</p>
                {item.description ? <p className="mt-1 text-muted">{item.description}</p> : null}
                <p className="mt-1 text-muted">
                  {item.allowed_extensions.length > 0 ? `Формат: ${item.allowed_extensions.join(', ')}` : null}
                  {item.name_template ? ` · имя файла: ${item.name_template}` : ''}
                  {item.due_at ? ` · срок: ${formatMoscowDate(item.due_at)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 max-w-measure text-sm text-muted">
          Материалы загружаются в личном кабинете команды. Если срок подтверждения пропущен, команда теряет право на
          участие во втором (финальном) этапе.
        </p>
        <div className="mt-5">
          <ActionLink to="/cabinet/final" variant="secondary">
            Подтвердить участие
          </ActionLink>
        </div>
      </Section>

      <Section
        title="Решения финального этапа"
        description="Пункт 9.6 Положения: обжалованию не подлежат."
      >
        <Prose>
          <p>
            Решения второго (финального) этапа, принятые по итогам голосования Жюри и зала, апелляции не подлежат.
            Апелляции рассматриваются только по итогам отборочного и первого этапов.
          </p>
        </Prose>
        <div className="mt-5">
          <ActionLink to="/stages/appeals" variant="secondary">
            Апелляции
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
