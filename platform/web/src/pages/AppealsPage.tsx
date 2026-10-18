import { APPEAL_GROUNDS, pluralize } from '@shared/index';
import { ActionLink, PageHeader, Prose, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';
import { useOrganizerText } from './StagesPage';

// Апелляции: раздел 12 Положения (ТЗ 02, п. 8; ТЗ 08, п. 2.1).
//
// Срок подачи берётся из активного сезона (appeal_window_days), основания —
// из справочника APPEAL_GROUNDS, по которому строится форма в личном кабинете:
// страница и форма апелляции не могут разойтись.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
  { name: 'Апелляции', path: '/stages/appeals' },
]);

/** Случаи, которые не являются основанием для апелляции (пункт 12.2 Положения). */
const NOT_GROUNDS = [
  'несогласие с оценкой без указания конкретного нарушения;',
  'невнимательность к тексту Положения о конкурсе;',
  'технические сбои на стороне участника;',
  'сравнение с другими командами;',
  'личные достижения участников, не относящиеся к оценке материалов.',
];

export function AppealsPage() {
  const { data: seasonData } = useSeason();
  const season = seasonData?.season ?? null;
  const organizerText = useOrganizerText('appeals');

  useSeo({
    title: 'Апелляции',
    description:
      'Порядок и сроки подачи апелляций по итогам отборочного и первого этапов конкурса «Лидеры права – 2027»: основания, подача через личный кабинет.',
    path: '/stages/appeals',
    jsonLd: BREADCRUMBS,
  });

  const appealWindow = season
    ? pluralize(season.appeal_window_days, ['рабочий день', 'рабочих дня', 'рабочих дней'])
    : null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Апелляции"
        lead={
          <>
            Апелляция — письменное возражение капитана команды на итоги отборочного или первого этапа. Подаётся через
            личный кабинет, рассматривается Апелляционной комиссией.
          </>
        }
        actions={
          <>
            <ActionLink to="/cabinet">Войти в личный кабинет</ActionLink>
            <ActionLink to="/contacts" variant="secondary">
              Связаться с Оргкомитетом
            </ActionLink>
          </>
        }
      />

      <Section
        title="Основания"
        description="Пункт 12.2 Положения: апелляция подаётся только по перечисленным основаниям."
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {APPEAL_GROUNDS.map((ground) => (
            <li key={ground.value}>{ground.title}.</li>
          ))}
        </ul>
        <div className="mt-6">
          <h3 className="text-h3 font-semibold">Не является основанием</h3>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
            {NOT_GROUNDS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Сроки">
        <ul className="flex flex-col gap-5 text-sm">
          <li>
            <p className="mono-label text-muted">Подача апелляции</p>
            <p className="mt-1">
              {appealWindow
                ? `${appealWindow} с момента опубликования протокола этапа. Отсчёт идёт по московскому времени.`
                : 'В срок, установленный Положением о конкурсе, с момента опубликования протокола этапа.'}
            </p>
          </li>
        </ul>
      </Section>

      <Section title="Порядок подачи" description="Форма — Приложение № 14 к Положению.">
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>Капитан команды входит в личный кабинет и открывает раздел апелляций.</li>
          <li>Выбирает этап, указывает основание из перечня выше и излагает обстоятельства.</li>
          <li>Отправляет апелляцию — система фиксирует дату и время подачи.</li>
          <li>Ожидает решения: статус и текст решения появляются в личном кабинете.</li>
        </ol>
        <div className="mt-6">
          <h3 className="text-h3 font-semibold">Возможные решения</h3>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>удовлетворить — допустить команду или пересчитать баллы;</li>
            <li>удовлетворить частично;</li>
            <li>отказать.</li>
          </ul>
          <p className="mt-3 max-w-measure text-sm text-muted">
            Удовлетворение апелляции не исключает другие команды из рейтинга: Оргкомитет вправе увеличить число
            допущенных команд (пункт 12.5 Положения).
          </p>
        </div>
      </Section>

      <Section
        title="Решения второго (финального) этапа"
        description="Пункт 9.6 Положения: обжалованию не подлежат."
      >
        <Prose>
          <p>
            Решения второго (финального) этапа, принятые по итогам голосования Жюри и зала, апелляции не подлежат.
            Апелляции принимаются только по итогам отборочного и первого этапов.
          </p>
        </Prose>
      </Section>

      {organizerText ? (
        <Section title="От Оргкомитета" description="Дополнительные сведения, опубликованные Оргкомитетом.">
          <Prose>
            <p className="whitespace-pre-line">{organizerText}</p>
          </Prose>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border border-border bg-raised px-5 py-4">
        <p className="max-w-measure text-sm text-muted">
          Вопрос по апелляции или техническая проблема с входом в личный кабинет — напишите Оргкомитету.
        </p>
        <div className="flex flex-wrap gap-3">
          <ActionLink to="/cabinet">Войти в личный кабинет</ActionLink>
          <ActionLink to="/contacts" variant="secondary">
            Связаться с Оргкомитетом
          </ActionLink>
        </div>
      </div>
    </main>
  );
}
