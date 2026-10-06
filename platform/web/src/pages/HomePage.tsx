import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type PublicMasterclass,
  type PublicPartner,
  type SeasonResponse,
  api,
  formatMoscowDate,
  formatMoscowHuman,
  pluralize,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ORGANIZATION_JSON_LD, useSeo } from '@/lib/seo';
import { ActionLink, GridCell, HairlineGrid } from '@/components/PageBlocks';

// Главная страница конкурса.
//
// Оформление повторяет прежний сайт конкурса: первый экран во всю высоту с
// фотографией, плакатный заголовок, сетки с волосяными линиями для показателей,
// преимуществ и партнёров, тёмная полоса призыва к участию. Содержание — по
// Положению и из базы: сроки, мастер-классы, партнёры.

const STAGES = [
  {
    title: 'Отборочный этап',
    text: 'Заочно: экспертиза законотворческих инициатив Конкурсной комиссией. Нужны текст законопроекта и пояснительная записка.',
  },
  {
    title: 'Первый этап',
    text: 'Дистанционно: видеопрезентация инициативы и команды во «ВКонтакте», оценка видеороликов и материалов.',
  },
  {
    title: 'Второй (финальный) этап',
    text: 'Очно в Москве: групповые выступления, дебаты и Гранд-финал перед Жюри.',
  },
];

const BENEFITS = [
  {
    title: 'Стажировки',
    text: 'Ведущие юридические компании и органы власти для победителей и финалистов.',
    image: '/assets/benefits-person.jpg',
    alt: 'Участник конкурса «Лидеры права» на выступлении',
  },
  {
    title: 'Наставники',
    text: 'Работа с экспертами: преподаватели, практикующие юристы, представители власти и бизнеса.',
    image: '/assets/timeline-2025.jpg',
    alt: 'Команда конкурса с наставником',
  },
  {
    title: 'Публикация инициатив',
    text: 'Лучшие законопроекты направляются субъектам права законодательной инициативы и публикуются в архиве.',
    image: '/assets/timeline-2024.jpg',
    alt: 'Защита законотворческой инициативы',
  },
  {
    title: 'Признание',
    text: 'Дипломы, публикации в сборниках и признание в профессиональном сообществе.',
    image: '/assets/timeline-2022.jpg',
    alt: 'Награждение победителей конкурса',
  },
];

export function HomePage() {
  const [season, setSeason] = useState<SeasonResponse | null>(null);
  const [masterclasses, setMasterclasses] = useState<PublicMasterclass[]>([]);
  const [partners, setPartners] = useState<PublicPartner[]>([]);
  const [error, setError] = useState<string | null>(null);

  useSeo({
    title: 'Конкурс для студентов и молодых юристов',
    description:
      'Десятый ежегодный федеральный научно-образовательный конкурс «Лидеры права – 2027»: подача заявки на сайте, работа с наставниками, финал в Москве, стажировки и публикация законотворческих инициатив.',
    path: '/',
    jsonLd: ORGANIZATION_JSON_LD,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [seasonData, masterclassesData, partnersData] = await Promise.all([
          api.season(),
          api.masterclasses().catch(() => []),
          api.partners().catch(() => []),
        ]);
        if (!active) return;
        setSeason(seasonData);
        setMasterclasses(masterclassesData.slice(0, 3));
        setPartners(partnersData);
      } catch {
        if (active) setError('Не удалось загрузить данные сезона. Обновите страницу позже.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const seasonInfo = season?.season ?? null;
  const open = seasonInfo?.is_application_open === true;
  const notStarted = seasonInfo?.application_not_started === true;
  const announced = masterclasses.filter((item) => item.status === 'announced');

  return (
    <main>
      {error ? (
        <div className="mx-auto max-w-container px-[var(--gutter-wide)] pt-6">
          <Alert tone="warning">{error}</Alert>
        </div>
      ) : null}

      {/* Первый экран: слева плакат и действия, справа фотография. */}
      <section className="block border-b-0">
        <div className="mx-auto grid max-w-container gap-10 px-[var(--gutter-wide)] lg:grid-cols-[1.35fr_0.65fr]">
          <div className="flex flex-col justify-between gap-8">
            <div className="mono-label flex flex-wrap justify-between gap-2 text-muted">
              <span>Сезон 2026/2027</span>
              <span>Три этапа · финал в Москве</span>
            </div>

            <div>
              <h1 className="poster-hero">
                Лидеры
                <br />
                права
              </h1>
              <p className="mt-6 max-w-measure text-lead">
                Десятый ежегодный федеральный научно-образовательный конкурс для студентов и молодых специалистов.
                Участие бесплатное: команда разрабатывает законотворческую инициативу, работает с наставниками и
                защищает её перед Жюри.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
              {open ? (
                <ActionLink to="/apply">Подать заявку</ActionLink>
              ) : (
                <ActionLink to="/apply" variant="secondary">
                  {notStarted ? 'Приём заявок ещё не открыт' : 'Приём заявок завершён'}
                </ActionLink>
              )}
              <ActionLink to="/about/regulations" variant="secondary">
                Положение о конкурсе
              </ActionLink>
              {notStarted && seasonInfo?.application_open_at ? (
                <span className="text-sm text-muted">
                  Приём откроется {formatMoscowDate(seasonInfo.application_open_at)}
                </span>
              ) : null}
            </div>
          </div>

          <figure className="media-frame min-h-[320px] lg:min-h-full">
            <img src="/assets/benefits-person.jpg" alt="Участник конкурса «Лидеры права»" className="media-cover" />
          </figure>
        </div>
      </section>

      {/* Показатели сезона: сетка с волосяными линиями. */}
      <section className="block border-b-0 pt-0">
        <div className="mx-auto max-w-container px-[var(--gutter-wide)]">
          <HairlineGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
            <GridCell num="10" title="Сезон конкурса" text="Конкурс проводится с 2017 года" />
            <GridCell num="2–4" title="Человека в команде" text="Единоличное участие — по согласованию с Оргкомитетом" />
            <GridCell num="70" title="Баллов отборочного этапа" text="Критерии оценки — раздел 10 Положения" />
            <GridCell
              num={open ? 'идёт' : notStarted ? 'скоро' : 'закрыт'}
              title="Приём заявок"
              text={
                open
                  ? `до ${formatMoscowHuman(seasonInfo?.application_close_at ?? null)}`
                  : notStarted
                    ? `с ${formatMoscowDate(seasonInfo?.application_open_at ?? null)}`
                    : `завершён ${formatMoscowDate(seasonInfo?.application_close_at ?? null)}`
              }
            />
          </HairlineGrid>
        </div>
      </section>

      {/* Этапы конкурса. */}
      <section className="block" aria-labelledby="stages-title">
        <div className="mx-auto max-w-container px-[var(--gutter-wide)]">
          <h2 id="stages-title" className="poster-1 mb-8">
            Этапы конкурса
          </h2>
          <HairlineGrid>
            {STAGES.map((stage) => (
              <GridCell key={stage.title} title={stage.title} text={stage.text} />
            ))}
          </HairlineGrid>
          <p className="mt-6">
            <Link to="/stages" className="text-accent underline underline-offset-2">
              Календарь, критерии оценки и апелляции
            </Link>
          </p>
        </div>
      </section>

      {/* Преимущества участия: карточки с фотографиями. */}
      <section className="block block-sand" aria-labelledby="benefits-title">
        <div className="mx-auto max-w-container px-[var(--gutter-wide)]">
          <h2 id="benefits-title" className="poster-1 mb-8">
            Что получают участники
          </h2>
          <HairlineGrid columns="repeat(auto-fit, minmax(260px, 1fr))">
            {BENEFITS.map((benefit) => (
              <GridCell
                key={benefit.title}
                title={benefit.title}
                text={benefit.text}
                imageUrl={benefit.image}
                imageAlt={benefit.alt}
              />
            ))}
          </HairlineGrid>
        </div>
      </section>

      {/* Мастер-классы для команд-финалистов. */}
      {announced.length > 0 ? (
        <section className="block" aria-labelledby="masterclasses-title">
          <div className="mx-auto max-w-container px-[var(--gutter-wide)]">
            <h2 id="masterclasses-title" className="poster-1 mb-8">
              Ближайшие мастер-классы
            </h2>
            <HairlineGrid>
              {announced.map((item) => (
                <GridCell
                  key={item.id}
                  title={item.title}
                  text={
                    <>
                      {item.speaker}
                      <br />
                      {formatMoscowHuman(item.starts_at)}
                    </>
                  }
                  action={
                    <Link
                      to={`/masterclasses/${item.slug ?? `masterclass-${item.id}`}`}
                      className="text-accent underline underline-offset-2"
                    >
                      Подробнее
                    </Link>
                  }
                />
              ))}
            </HairlineGrid>
            <p className="mt-6">
              <Link to="/masterclasses" className="text-accent underline underline-offset-2">
                Все мастер-классы
              </Link>
            </p>
          </div>
        </section>
      ) : null}

      {/* Архив, победители и история. */}
      <section className="block" aria-labelledby="archive-title">
        <div className="mx-auto max-w-container px-[var(--gutter-wide)]">
          <h2 id="archive-title" className="poster-1 mb-8">
            Архив и победители
          </h2>
          <HairlineGrid>
            <GridCell
              title="Архив законопроектов"
              text="Инициативы, прошедшие конкурс: ориентир для новых участников."
              action={
                <Link to="/initiatives" className="text-accent underline underline-offset-2">
                  Открыть архив
                </Link>
              }
            />
            <GridCell
              title="Победители"
              text={`${pluralize(9, ['сезон', 'сезона', 'сезонов'])} конкурса: команды и номинации по годам.`}
              action={
                <Link to="/winners" className="text-accent underline underline-offset-2">
                  Смотреть победителей
                </Link>
              }
            />
            <GridCell
              title="История конкурса"
              text="Как развивался конкурс и что изменилось в десятом сезоне."
              action={
                <Link to="/about/history" className="text-accent underline underline-offset-2">
                  История конкурса
                </Link>
              }
            />
          </HairlineGrid>
        </div>
      </section>

      {/* Партнёры. */}
      <section className="block block-sand" aria-labelledby="partners-title">
        <div className="mx-auto max-w-container px-[var(--gutter-wide)]">
          <h2 id="partners-title" className="poster-1 mb-8">
            Партнёры конкурса
          </h2>
          {partners.length > 0 ? (
            <HairlineGrid columns="repeat(auto-fit, minmax(220px, 1fr))">
              {partners.map((partner) => (
                <GridCell
                  key={partner.id}
                  title={partner.name}
                  text={partner.description}
                  imageUrl={partner.logo_url ?? undefined}
                  imageAlt={`Логотип: ${partner.name}`}
                  action={
                    partner.url ? (
                      <a
                        href={partner.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline underline-offset-2"
                      >
                        Сайт партнёра
                      </a>
                    ) : null
                  }
                />
              ))}
            </HairlineGrid>
          ) : (
            <p className="max-w-measure text-muted">
              Учредитель конкурса — Ассоциация выпускников СЮИ – СГАП – СГЮА, генеральный партнёр — Общероссийская
              общественная организация «Ассоциация юристов России». Остальные партнёры публикуются после утверждения
              списка Оргкомитетом.
            </p>
          )}
        </div>
      </section>

      {/* Призыв к участию: тёмная полоса прежнего сайта. */}
      <section className="block block-ink border-b-0">
        <div className="mx-auto grid max-w-container items-start gap-10 px-[var(--gutter-wide)] md:grid-cols-2">
          <div>
            <p className="mono-label text-accent-bright">Приём заявок — только на сайте</p>
            <h2 className="poster-1 mt-4 text-[var(--paper)]">
              Соберите команду
              <br />и подайте заявку
            </h2>
          </div>
          <div className="flex flex-col gap-6">
            <p className="max-w-measure text-[color-mix(in_srgb,var(--paper)_90%,transparent)]">
              Заявка заполняется по шагам: команда и инициатива, участники, наставники, конкурсные материалы, согласия
              и проверка. Черновик сохраняется, поэтому заполнение можно прервать и продолжить.
            </p>
            <div className="flex flex-wrap gap-3">
              <ActionLink to="/apply">Перейти к заявке</ActionLink>
              <ActionLink to="/participants" variant="secondary">
                Как участвовать
              </ActionLink>
            </div>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              <li>
                Требования к участникам и состав команды —{' '}
                <Link to="/participants/requirements" className="underline underline-offset-2">
                  раздел «Участникам»
                </Link>
              </li>
              <li>
                Состав конкурсных материалов по этапам —{' '}
                <Link to="/participants/materials" className="underline underline-offset-2">
                  требования к материалам
                </Link>
              </li>
              <li>
                Вопросы Оргкомитету —{' '}
                <Link to="/contacts" className="underline underline-offset-2">
                  контакты и форма обращения
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
