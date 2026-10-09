import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type PublicExpert, type PublicPage, api, pluralize } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Оргкомитет и эксперты: органы конкурса по п. 10 ТЗ 02 и состав из `experts`
// (ТЗ 08, п. 2.1). API отдаёт только публичные поля: ФИО, организация,
// должность, учёная степень, сведения о человеке и фото.

/** Органы конкурса и их задачи — п. 10 Положения. */
const ORGANS: Array<{ title: string; description: string }> = [
  {
    title: 'Оргкомитет',
    description:
      'Ведёт конкурс: приём заявок, допуск и отказ по итогам технической проверки, публикация итогов, составы комиссий, даты этапов и решения о дисквалификации.',
  },
  {
    title: 'Конкурсная комиссия отборочного этапа',
    description: 'Оценивает конкурсные материалы отборочного этапа по критериям Положения.',
  },
  {
    title: 'Конкурсная комиссия первого этапа',
    description: 'Оценивает видеоролики и конкурсные материалы первого этапа по критериям Положения.',
  },
  {
    title: 'Жюри финального этапа',
    description: 'Оценивает дебаты второго (финального) этапа и голосованием определяет победителей Гранд-финала.',
  },
  {
    title: 'Эксперты',
    description: 'Консультируют участников, участвуют в обсуждении законотворческих инициатив и работают с конкурсными материалами.',
  },
  {
    title: 'Апелляционная комиссия',
    description:
      'Рассматривает апелляции команд по итогам отборочного и первого этапов. В её состав не входят члены комиссий, оценивавшие материалы.',
  },
  {
    title: 'Счётная группа',
    description: 'Подсчитывает голоса зала на втором (финальном) этапе.',
  },
];

/** Группы состава: значения поля `stage` в справочнике экспертов и Жюри. */
const STAGES: Array<{ key: string; title: string }> = [
  { key: 'organizing_committee', title: 'Оргкомитет' },
  { key: 'selection', title: 'Конкурсная комиссия отборочного этапа' },
  { key: 'stage1', title: 'Конкурсная комиссия первого этапа' },
  { key: 'debate', title: 'Жюри финального этапа' },
  { key: 'expert', title: 'Эксперты' },
  { key: 'appeal_commission', title: 'Апелляционная комиссия' },
  { key: 'counting_group', title: 'Счётная группа' },
];

/** Инициалы для нейтральной заглушки вместо фотографии. */
function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** Карточка человека: фото или нейтральная заглушка с инициалами. */
function ExpertCard({ expert }: { expert: PublicExpert }) {
  const isChair = expert.role === 'chair';
  return (
    <li className="flex gap-4 border border-border p-5">
      {expert.photo_url ? (
        <img
          src={expert.photo_url}
          alt={`Фотография: ${expert.full_name}`}
          loading="lazy"
          className="h-24 w-24 shrink-0 border border-border object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label={`Фотография не опубликована: ${expert.full_name}`}
          className="flex h-24 w-24 shrink-0 items-center justify-center border border-border bg-surface font-mono text-h3 text-muted"
        >
          {initials(expert.full_name)}
        </div>
      )}
      <div className="min-w-0">
        {isChair ? <p className="mono-label mb-1 text-accent">Председатель</p> : null}
        <h3 className="text-h3 font-semibold">{expert.full_name}</h3>
        {expert.position ? <p className="mt-1 text-sm">{expert.position}</p> : null}
        {expert.organization ? <p className="text-sm text-muted">{expert.organization}</p> : null}
        {expert.degree ? <p className="text-sm text-muted">{expert.degree}</p> : null}
        {expert.about ? <p className="mt-2 max-w-measure text-sm">{expert.about}</p> : null}
      </div>
    </li>
  );
}

export function OrganizersPage() {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [experts, setExperts] = useState<PublicExpert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: page?.seo_title ?? 'Оргкомитет и эксперты',
    description:
      page?.seo_description ??
      'Органы конкурса «Лидеры\u00A0права\u00A0– 2027» и их состав: Оргкомитет, Конкурсная комиссия отборочного и первого этапов, Жюри финального этапа, эксперты, Апелляционная комиссия и Счётная группа.',
    path: '/about/organizers',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'О конкурсе', path: '/about' },
      { name: 'Оргкомитет и эксперты', path: '/about/organizers' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.page('about-organizers');
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
        // Состав Жюри ведётся в отдельном справочнике (jury_members), поэтому
        // его состав объединяется с составом комиссий; недоступность одного из
        // списков не должна скрывать другой.
        const [expertsData, jury] = await Promise.all([
          api.experts(),
          api.jury().catch(() => [] as PublicExpert[]),
        ]);
        if (!active) return;
        const merged = [...expertsData];
        for (const member of jury) {
          if (!merged.some((person) => person.id === member.id && person.full_name === member.full_name)) {
            merged.push(member);
          }
        }
        setExperts(merged);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить состав.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Председатели идут первыми: API сортирует по значению роли, а не по статусу.
  const stages = STAGES.map((stage) => ({
    ...stage,
    people: experts
      .filter((expert) => expert.stage === stage.key)
      .sort(
        (a, b) =>
          (a.role === 'chair' ? -1 : b.role === 'chair' ? 1 : 0) || a.full_name.localeCompare(b.full_name, 'ru')
      ),
  }));
  const pendingStages = stages.filter((stage) => stage.people.length === 0);
  const hasPeople = experts.length > 0;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="О конкурсе"
        title={page?.title ?? 'Оргкомитет и эксперты'}
        lead="Кто ведёт конкурс, оценивает конкурсные материалы и определяет победителей. Состав комиссий и Жюри публикуется после утверждения."
        actions={
          <ActionLink to="/contacts" variant="secondary">
            Связаться с Оргкомитетом
          </ActionLink>
        }
      />

      {page?.body ? (
        <Section title="О разделе" description="Текст, подготовленный Оргкомитетом.">
          <Prose>
            <p className="whitespace-pre-line">{page.body}</p>
          </Prose>
        </Section>
      ) : null}

      <Section title="Органы конкурса" description="Задачи органов по Положению о конкурсе.">
        <dl className="grid gap-5 sm:grid-cols-2">
          {ORGANS.map((organ) => (
            <div key={organ.title}>
              <dt className="font-medium">{organ.title}</dt>
              <dd className="mt-1 max-w-measure text-sm text-muted">{organ.description}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем состав…</p>
      ) : !hasPeople ? (
        <Alert tone="info" title="Состав публикуется после утверждения">
          Персональный состав Конкурсной комиссии и Жюри публикуется после утверждения Оргкомитетом. Пока на
          странице описаны органы конкурса и их задачи; имена появятся по мере публикации. Вопросы —{' '}
          <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
            lidery.prava@mail.ru
          </a>
          .
        </Alert>
      ) : (
        <>
          {stages.map((stage) =>
            stage.people.length === 0 ? null : (
              <Section
                key={stage.key}
                title={stage.title}
                description={`Состав: ${pluralize(stage.people.length, ['человек', 'человека', 'человек'])}.`}
              >
                <ul className="grid gap-5 sm:grid-cols-2">
                  {stage.people.map((expert) => (
                    <ExpertCard key={expert.id} expert={expert} />
                  ))}
                </ul>
              </Section>
            )
          )}

          {pendingStages.length > 0 ? (
            <p className="max-w-measure text-sm text-muted">
              Состав органов, которые ещё не опубликованы ({pendingStages.map((stage) => stage.title).join('; ')}),
              появится после утверждения Оргкомитетом. Сведения о человеке публикуются только при наличии
              согласия.
            </p>
          ) : null}
        </>
      )}

      <p className="text-sm text-muted">
        Порядок оценки и состав органов закреплены в{' '}
        <Link to="/about/regulations" className="text-accent underline underline-offset-2">
          Положении о конкурсе
        </Link>
        . Сроки подачи апелляций — в разделе{' '}
        <Link to="/stages/appeals" className="text-accent underline underline-offset-2">
          «Апелляции»
        </Link>
        .
      </p>
    </main>
  );
}
