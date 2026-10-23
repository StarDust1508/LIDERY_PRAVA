import { Link } from 'react-router-dom';
import { Alert, Button, formatMoscowDate, formatMoscowHuman, pluralize } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';
import { formatPeriod } from './StagesPage';

// Календарный план конкурса из активного сезона (ТЗ 02, п. 2; ТЗ 08, п. 2.1 и 3.6).
//
// Даты не хранятся в коде: они ведутся в сущности seasons и показываются из БД.
// Поэтому таблица собирается из полей сезона, а не из текста Положения — при
// смене срока Оргкомитетом страница меняется автоматически.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
  { name: 'Календарь', path: '/stages/calendar' },
]);

/** Дата за указанное число календарных дней до события. */
function daysBefore(value: string | null, days: number): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

interface CalendarRow {
  id: string;
  period: string;
  event: string;
  form: string;
}

export function CalendarPage() {
  const { data, loading, error, reload } = useSeason();
  const season = data?.season ?? null;

  useSeo({
    title: 'Календарь конкурса',
    description:
      'Календарный план конкурса «Лидеры права – 2027»: приём заявок, техническая проверка, первый и второй (финальный) этапы, подтверждение участия и апелляции. Все сроки по московскому времени.',
    path: '/stages/calendar',
    jsonLd: BREADCRUMBS,
  });

  const confirmationDue = daysBefore(season?.final_from ?? null, 7);

  const rows: CalendarRow[] = season
    ? [
        {
          id: 'application',
          period: formatPeriod(season.application_open_at, season.application_close_at),
          event: 'Приём заявок и конкурсных материалов отборочного этапа',
          form: 'Дистанционно',
        },
        {
          id: 'tech-check',
          period: formatPeriod(season.tech_check_from, season.tech_check_to),
          event: 'Техническая проверка конкурсных материалов',
          form: 'Дистанционно',
        },
        {
          id: 'expertise',
          period: formatPeriod(season.expertise_from ?? null, season.expertise_to ?? null),
          event: 'Экспертиза и оценка законотворческих инициатив онлайн-комиссией',
          form: 'Дистанционно',
        },
        {
          id: 'protocol-selection',
          period: season.protocol_selection_at
            ? `Не позднее ${formatMoscowDate(season.protocol_selection_at)}`
            : 'Не позднее 15 января 2027 года',
          event: 'Публикация протокола итогов отборочного этапа',
          form: 'Дистанционно',
        },
        {
          id: 'video',
          period: formatPeriod(season.video_publication_from ?? null, season.video_publication_to ?? null),
          event: 'Подготовка и публикация видеороликов в сообществе конкурса во «ВКонтакте»',
          form: 'Дистанционно',
        },
        {
          id: 'stage1-evaluation',
          period: formatPeriod(season.stage1_evaluation_from ?? null, season.stage1_evaluation_to ?? null),
          event: 'Оценка видеороликов и материалов первого этапа, подсчёт «Приза зрительских симпатий»',
          form: 'Дистанционно',
        },
        {
          id: 'protocol-stage1',
          period: season.protocol_stage1_at
            ? `Не позднее ${formatMoscowDate(season.protocol_stage1_at)}`
            : 'Не позднее 5 марта 2027 года',
          event: 'Публикация протокола итогов первого этапа (команды-финалисты)',
          form: 'Дистанционно',
        },
        {
          id: 'masterclasses',
          period: formatPeriod(season.masterclasses_from ?? null, season.masterclasses_to ?? null),
          event: 'Мастер-классы для команд-финалистов',
          form: 'Дистанционно и очно',
        },
        {
          id: 'confirmation',
          period: confirmationDue ? `Не позднее ${formatMoscowDate(confirmationDue)}` : 'Не позднее чем за 7 календарных дней до этапа',
          event: 'Подтверждение участия и представление презентационных материалов',
          form: 'Дистанционно',
        },
        {
          id: 'final',
          period: formatPeriod(season.final_from, season.final_to),
          event: 'Второй (финальный) этап: групповые выступления, дебаты, Гранд-финал, награждение',
          form: 'Очно, Москва, ул. Садовая-Спасская, 21/1',
        },
        {
          id: 'appeals',
          period: `${pluralize(season.appeal_window_days, ['рабочий день', 'рабочих дня', 'рабочих дней'])} с момента опубликования протокола этапа`,
          event: 'Подача апелляций по итогам отборочного и первого этапов',
          form: 'Дистанционно',
        },
        {
          id: 'post-final',
          period: formatPeriod(season.post_final_from ?? null, season.post_final_to ?? null),
          event: 'Открытая дискуссия с депутатами Государственной Думы, стажировки',
          form: 'Очно, Москва, ул. Садовая-Спасская, 21/1',
        },
      ]
        // Строки, для которых в сезоне нет дат, не показываем: пустой прочерк в
        // календаре выглядит как ошибка, а не как отсутствие срока.
        .filter((row) => row.period !== '—')
    : [];

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Календарь конкурса"
        lead={
          <>
            Календарный план сезона: {season?.title ?? '«Лидеры\u00a0права\u00a0– 2027»'}. Все сроки указаны по
            московскому времени (МСК, UTC+3); окончание срока — 23:59 последнего дня.
          </>
        }
        actions={
          season?.is_application_open ? (
            <ActionLink to="/apply">Подать заявку</ActionLink>
          ) : (
            <ActionLink to="/stages/selection" variant="secondary">
              Об отборочном этапе
            </ActionLink>
          )
        }
      />

      {error ? (
        <Alert tone="danger" title="Календарь недоступен">
          <p>{error}</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={reload}>
              Повторить запрос
            </Button>
          </div>
        </Alert>
      ) : null}

      <Section
        title="Календарный план"
        description="Таблица собрана из дат активного сезона; при изменении срока Оргкомитетом страница обновляется автоматически."
      >
        {loading && !season ? (
          <p role="status" className="text-sm text-muted">
            Загружаем календарь…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">
            Даты сезона не получены. Повторите запрос выше или откройте страницу позже.
          </p>
        ) : (
          <ResponsiveTable
            caption="Календарный план конкурса «Лидеры права – 2027»"
            columns={['Период (МСК)', 'Мероприятие', 'Форма участия']}
            rows={rows}
            rowKey={(row) => row.id}
            renderCell={(row, index) => {
              if (index === 0) return <span className="font-mono">{row.period}</span>;
              if (index === 1) return <span>{row.event}</span>;
              return <span>{row.form}</span>;
            }}
          />
        )}
      </Section>

      <Section title="Правила работы со сроками" description="Пункты 6.2 и 6.3 Положения о конкурсе.">
        <Prose>
          <p>
            Даты могут меняться решением Оргкомитета. Об изменении срока Оргкомитет сообщает на официальных ресурсах
            конкурса не позднее чем за 5 календарных дней.
          </p>
          <p className="text-muted">
            Срок публикации протокола итогов отборочного этапа определяется Оргкомитетом после завершения экспертизы;
            даты мастер-классов для команд-финалистов объявляются отдельно в разделе{' '}
            <Link to="/masterclasses" className="text-accent underline underline-offset-2">
              «Мастер-классы»
            </Link>
            .
          </p>
          {season && !season.is_application_open ? (
            <p className="text-muted">
              {season.application_not_started
                ? `Приём заявок откроется ${formatMoscowHuman(season.application_open_at)}.`
                : `Приём заявок завершён — ${formatMoscowHuman(season.application_close_at)}.`}
            </p>
          ) : null}
        </Prose>
      </Section>
    </main>
  );
}
