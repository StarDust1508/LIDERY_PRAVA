import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type MaterialRequirementsResponse,
  PARTICIPANT_CATEGORIES,
  api,
  formatMoscowHuman,
  formatTimeLeft,
  pluralize,
} from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { ActionLink, PageHeader, Prose } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';

// Раздел «Участникам» — хаб «Как участвовать» (ТЗ 08, п. 2.1).
//
// Страница отвечает на первый вопрос будущей команды: что её ждёт по шагам и
// куда идти дальше. Подробности живут на подстраницах, а сроки берутся из
// активного сезона и из состава комплекта конкурсных материалов, поэтому хаб не
// расходится с приёмом заявок.

const PATH_STEPS = [
  {
    title: 'Заявка',
    text: 'Капитан команды заполняет мастер подачи на сайте: сведения о команде, законотворческой инициативе, участниках и наставниках. Заявка подаётся только через форму на сайте — внешние формы и почта не используются.',
  },
  {
    title: 'Конкурсные материалы',
    text: 'К заявке прикладываются конкурсные материалы отборочного этапа: текст законопроекта с экономическим обоснованием и пояснительная записка.',
  },
  {
    title: 'Техническая проверка',
    text: 'Оргкомитет проверяет комплект, сроки и соответствие требованиям к участникам. Устранимые недостатки оформления предлагается исправить один раз.',
  },
  {
    title: 'Экспертиза',
    text: 'Конкурсная комиссия оценивает законотворческие инициативы по критериям отборочного этапа: не менее трёх членов комиссии оценивают каждую работу независимо друг от друга.',
  },
  {
    title: 'Протокол',
    text: 'Протокол итогов отборочного этапа публикуется на сайте. Срок подачи апелляций — два рабочих дня с момента опубликования протокола.',
  },
  {
    title: 'Первый этап',
    text: 'Команда публикует видеоролик о своей инициативе во «ВКонтакте», Конкурсная комиссия оценивает видеопрезентации и материалы первого этапа.',
  },
  {
    title: 'Второй (финальный) этап',
    text: 'Команды-финалисты выступают очно в Москве: групповые выступления, дебаты и Гранд-финал перед Жюри.',
  },
];

export function ParticipantsPage() {
  const { data } = useSeason();
  const [selection, setSelection] = useState<MaterialRequirementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useSeo({
    title: 'Как участвовать',
    description:
      'Путь команды в конкурсе «Лидеры права – 2027»: заявка на сайте, конкурсные материалы отборочного этапа, техническая проверка, экспертиза, первый этап и финал в Москве. Требования к участникам и срокам.',
    path: '/participants',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Участникам', path: '/participants' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.materialRequirements('selection');
        if (active) setSelection(data);
      } catch {
        if (active) setError('Не удалось загрузить состав конкурсных материалов. Часть сроков может быть недоступна.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const season = data?.season ?? null;
  const closeAt = season?.application_close_at ?? selection?.application_close_at ?? null;
  const closeTimestamp = closeAt ? new Date(closeAt).getTime() : null;
  const timeLeft = closeTimestamp === null ? null : formatTimeLeft(closeTimestamp - Date.now());

  const required = (selection?.requirements ?? []).filter(
    (item) => item.is_required && !['application_form', 'consent_pdn', 'consent_legal_rep'].includes(item.type)
  );

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Участникам"
        title="Как участвовать"
        lead="Команда разрабатывает законотворческую инициативу, проходит отборочный и первый этапы дистанционно и защищает работу перед Жюри в Москве. Заявка подаётся только на этом сайте."
        actions={
          <>
            <ActionLink to="/apply">Подать заявку</ActionLink>
            <ActionLink to="/participants/requirements" variant="secondary">
              Требования к участникам
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <SectionCard title="Сроки приёма заявок" description="Все сроки указаны по московскому времени.">
        <dl className="grid gap-5 text-sm md:grid-cols-3">
          <div>
            <dt className="mono-label text-muted">Начало приёма</dt>
            <dd className="mt-1">{season ? formatMoscowHuman(season.application_open_at) : '—'}</dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Окончание приёма</dt>
            <dd className="mt-1">{closeAt ? formatMoscowHuman(closeAt) : '—'}</dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Осталось</dt>
            <dd className="mt-1">
              {season?.is_application_open === false
                ? 'приём заявок завершён'
                : (timeLeft ?? 'срок определяется Оргкомитетом')}
            </dd>
          </div>
        </dl>
        <p className="mt-4 max-w-measure text-sm text-muted">
          Дата подачи заявки — дата поступления материалов в электронную форму. Даты могут быть изменены решением
          Оргкомитета с публикацией не позднее чем за 5 календарных дней.
        </p>
      </SectionCard>

      <SectionCard title="Путь команды" description="Семь шагов от заявки до финала.">
        <ol className="flex flex-col gap-5">
          {PATH_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 border-b border-border pb-4 last:border-b-0 last:pb-0"
            >
              <span className="mono-label text-muted" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="text-h3 font-semibold">{step.title}</h3>
                <p className="mt-1 max-w-measure text-sm text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Что читать дальше" description="Подстраницы раздела «Участникам».">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="border border-border p-5">
            <h3 className="text-h3 font-semibold">Требования к участникам</h3>
            <p className="mt-2 text-sm text-muted">
              Возраст, категории участников, состав команды, наставники и ограничения. Что система проверяет
              автоматически, а что — Оргкомитет.
            </p>
            <p className="mt-3">
              <ActionLink to="/participants/requirements" variant="secondary">
                Открыть
              </ActionLink>
            </p>
          </div>
          <div className="border border-border p-5">
            <h3 className="text-h3 font-semibold">Конкурсные материалы</h3>
            <p className="mt-2 text-sm text-muted">
              Состав комплекта по трём этапам, требования к форматам и объёму файлов, правила приёма и сроки.
            </p>
            <p className="mt-3">
              <ActionLink to="/participants/materials" variant="secondary">
                Открыть
              </ActionLink>
            </p>
          </div>
          <div className="border border-border p-5">
            <h3 className="text-h3 font-semibold">Требования к видеоролику</h3>
            <p className="mt-2 text-sm text-muted">
              Что показать в видеоролике первого этапа, где его публиковать во «ВКонтакте» и по каким критериям его
              оценивает Конкурсная комиссия.
            </p>
            <p className="mt-3">
              <ActionLink to="/participants/video-requirements" variant="secondary">
                Открыть
              </ActionLink>
            </p>
          </div>
          <div className="border border-border p-5">
            <h3 className="text-h3 font-semibold">Подать заявку</h3>
            <p className="mt-2 text-sm text-muted">
              Мастер подачи на сайте: команда и инициатива, участники, наставники, конкурсные материалы и согласия.
            </p>
            <p className="mt-3">
              <ActionLink to="/apply">Подать заявку</ActionLink>
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Кто может участвовать" description="Коротко — о требованиях к участникам.">
        <ul className="flex flex-col gap-3 text-sm">
          <li>Возраст — от 16 до 35 лет включительно на дату окончания приёма заявок.</li>
          <li>
            Категории участников:
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              {PARTICIPANT_CATEGORIES.map((category) => (
                <li key={category.value}>{category.title}</li>
              ))}
            </ul>
          </li>
          <li>Юридическое образование не требуется: участвовать могут студенты и специалисты любых направлений.</li>
          <li>Команда — от 2 до 4 человек; первым в заявке указывается капитан команды.</li>
          <li>Наставников может быть не более двух; наставники не являются участниками команды.</li>
          <li>
            Участники младше 18 лет допускаются при наличии согласия законного представителя (Приложение № 11).
          </li>
        </ul>
        <p className="mt-4 text-sm">
          <Link to="/participants/requirements" className="text-accent underline underline-offset-2">
            Полные требования к участникам
          </Link>
        </p>
      </SectionCard>

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard title="Участие бесплатное" description="Организационный взнос не взимается.">
          <Prose>
            <p className="text-sm">
              Участие в конкурсе добровольное и бесплатное: организационный взнос не взимается. Отдельной платы за
              подачу заявки Положением не предусмотрено.
            </p>
          </Prose>
        </SectionCard>

        <SectionCard
          title={`Обязательные материалы (${required.length})`}
          description="Комплект отборочного этапа по пункту 7.2 Положения."
        >
          <p className="mb-4 text-sm text-muted">
            В комплекте: {pluralize(required.length, ['обязательный материал', 'обязательных материала', 'обязательных материалов'])}.
          </p>
          {required.length === 0 ? (
            <p className="text-sm text-muted">Состав комплекта отборочного этапа загружается.</p>
          ) : (
            <>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {required.map((item) => (
                  <li key={item.type}>
                    {item.title}
                    {item.due_at ? ` — до ${formatMoscowHuman(item.due_at)}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm">
                <Link to="/participants/materials" className="text-accent underline underline-offset-2">
                  Требования к конкурсным материалам
                </Link>
              </p>
            </>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
