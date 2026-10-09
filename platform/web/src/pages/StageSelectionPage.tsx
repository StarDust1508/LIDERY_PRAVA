import { useEffect, useState } from 'react';
import {
  type MaterialRequirement,
  type PublicCriterion,
  api,
  formatMoscowHuman,
  pluralize,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';
import { formatPeriod, useOrganizerText } from './StagesPage';

// Отборочный этап (ТЗ 02, п. 5.1 и 6.1; ТЗ 08, п. 2.1).
//
// Сроки берутся из активного сезона, состав обязательного комплекта — из
// material_requirements, критерии — из справочника criteria. Ни один срок и ни
// одна сумма баллов не хранятся в коде страницы.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
  { name: 'Отборочный этап', path: '/stages/selection' },
]);

/** Типы материалов, которые участник готовит сам (без формы и согласий). */
const DOCUMENT_TYPES = ['law_draft', 'explanatory_note', 'acts_list', 'comparison_table'];

export function StageSelectionPage() {
  const { data: seasonData } = useSeason();
  const season = seasonData?.season ?? null;

  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [requirements, setRequirements] = useState<MaterialRequirement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const organizerText = useOrganizerText('stage-selection');

  useSeo({
    title: 'Отборочный этап',
    description:
      'Отборочный этап конкурса «Лидеры права – 2027»: приём заявок и конкурсных материалов, техническая проверка, экспертиза и оценка, критерии на 70 баллов.',
    path: '/stages/selection',
    jsonLd: BREADCRUMBS,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [criteriaData, requirementsData] = await Promise.all([
          api.criteria('selection'),
          api.materialRequirements('selection'),
        ]);
        if (!active) return;
        setCriteria(criteriaData);
        setRequirements(requirementsData.requirements);
      } catch {
        if (active) setError('Не удалось загрузить критерии и состав конкурсных материалов.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const totalScore = criteria.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);
  const documents = requirements.filter((item) => DOCUMENT_TYPES.includes(item.type));
  const requiredDocuments = documents.filter((item) => item.is_required);
  const optionalDocuments = documents.filter((item) => !item.is_required);

  const appealWindow = season
    ? `${pluralize(season.appeal_window_days, ['рабочий день', 'рабочих дня', 'рабочих дней'])} с момента опубликования протокола этапа`
    : 'срок, установленный Положением о конкурсе';

  function renderMaterial(item: MaterialRequirement) {
    return (
      <li key={item.type} className="border-b border-border pb-3">
        <p className="font-medium">
          {item.title}
          {item.is_required ? '' : ' — необязательно'}
        </p>
        {item.description ? <p className="mt-1 text-muted">{item.description}</p> : null}
        <p className="mt-1 text-muted">
          {item.allowed_extensions.length > 0 ? `Формат: ${item.allowed_extensions.join(', ')}` : 'Форма подачи: ссылка'}
          {item.name_template ? ` · имя файла: ${item.name_template}` : ''}
        </p>
        {item.due_at ? <p className="mt-1 text-muted">Срок: {formatMoscowHuman(item.due_at)}</p> : null}
      </li>
    );
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Отборочный этап"
        lead={
          <>
            Этап проходит дистанционно. Конкурсная комиссия оценивает законотворческие инициативы команд: текст
            законопроекта и пояснительную записку.
          </>
        }
        actions={
          <>
            {season?.is_application_open ? <ActionLink to="/apply">Подать заявку</ActionLink> : null}
            <ActionLink to="/stages/criteria" variant="secondary">
              Критерии оценки
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <Section title="Сроки" description="Все даты — по московскому времени (МСК, UTC+3).">
        {season ? (
          // Сроки читаются парами: на широком экране правая половина страницы
          // больше не пустует, а взгляд охватывает весь календарь этапа.
          <ul className="grid gap-5 text-sm md:grid-cols-2">
            <li>
              <p className="mono-label text-muted">Приём заявок и конкурсных материалов</p>
              <p className="mt-1">{formatPeriod(season.application_open_at, season.application_close_at)}</p>
              <p className="mt-1 text-muted">
                Окончание приёма — {formatMoscowHuman(season.application_close_at)}.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Техническая проверка конкурсных материалов</p>
              <p className="mt-1">{formatPeriod(season.tech_check_from, season.tech_check_to)}</p>
              <p className="mt-1 text-muted">
                Недостатки оформления, которые можно устранить, Оргкомитет предлагает исправить однократно —
                в срок не более двух рабочих дней (пункты 7.4 и 7.5 Положения).
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Экспертиза и оценка законотворческих инициатив</p>
              <p className="mt-1">
                {season.expertise_from || season.expertise_to
                  ? formatPeriod(season.expertise_from, season.expertise_to)
                  : 'Срок определяется после технической проверки'}
              </p>
              <p className="mt-1 text-muted">
                Проводится после технической проверки. Каждую инициативу оценивают члены Конкурсной комиссии.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Публикация протокола итогов отборочного этапа</p>
              <p className="mt-1">
                {season.protocol_selection_at
                  ? formatMoscowHuman(season.protocol_selection_at)
                  : 'После завершения экспертизы'}
              </p>
              <p className="mt-1 text-muted">
                Протокол публикуется на сайте; баллы команды видны в личном кабинете.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Подача апелляций</p>
              <p className="mt-1 text-muted">{appealWindow}.</p>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Сроки загружаются. Действующие даты собраны на странице «Календарь конкурса».
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionLink to="/stages/calendar" variant="secondary">
            Календарь конкурса
          </ActionLink>
        </div>
      </Section>

      <Section
        title="Обязательный комплект конкурсных материалов"
        description="Пункт 7.2 Положения. Состав комплекта ведёт Оргкомитет, поэтому страница и приём заявок не расходятся."
      >
        {requiredDocuments.length === 0 ? (
          <p className="text-sm text-muted">Комплект материалов загружается…</p>
        ) : (
          <ul className="flex flex-col gap-4 text-sm">{requiredDocuments.map(renderMaterial)}</ul>
        )}

        {optionalDocuments.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-h3 font-semibold">Дополнительно</h3>
            <p className="mt-1 text-sm text-muted">
              Представляются вместе с законопроектом по Приложению № 5 и усиливают инициативу при оценке.
            </p>
            <ul className="mt-3 flex flex-col gap-4 text-sm">{optionalDocuments.map(renderMaterial)}</ul>
          </div>
        ) : null}

        <p className="mt-6 max-w-measure text-sm text-muted">
          Согласия на обработку персональных данных и согласие законного представителя оформляются электронно прямо в
          мастере подачи заявки: отдельные файлы не нужны. Ссылки на облачные хранилища допускаются только на сервисы,
          зарегистрированные в Российской Федерации.
        </p>
        <div className="mt-5">
          <ActionLink to="/participants/materials" variant="secondary">
            Конкурсные материалы
          </ActionLink>
        </div>
      </Section>

      <Section
        title="Критерии отборочного этапа"
        description="Пункт 10.2 Положения. Каждый критерий оценивается по шкале от 0 до 10."
      >
        {criteria.length === 0 ? (
          <p className="text-sm text-muted">Критерии загружаются…</p>
        ) : (
          <>
            <ResponsiveTable
              caption="Критерии отборочного этапа и максимум баллов"
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
              Итого: <strong>{pluralize(totalScore, ['балл', 'балла', 'баллов'])}</strong> от одного члена Конкурсной
              комиссии.
            </p>
          </>
        )}
      </Section>

      <Section title="Что дальше" description="От отборочного этапа к первому.">
        <Prose>
          <p>
            Команды, прошедшие отборочный этап, допускаются к первому этапу: они готовят видеопрезентацию инициативы и
            команды. Итоговый балл этапа — среднее арифметическое сумм баллов членов Конкурсной комиссии с округлением
            до сотых.
          </p>
          <p className="text-muted">
            Если суммы баллов членов комиссии расходятся более чем на 20 баллов, материалы направляются на
            дополнительную оценку председателя Конкурсной комиссии; его балл учитывается при расчёте среднего
            (пункт 7.7 Положения).
          </p>
        </Prose>
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionLink to="/stages/first" variant="secondary">
            Первый этап
          </ActionLink>
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
