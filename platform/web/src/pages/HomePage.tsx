import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type PublicMasterclass,
  type PublicPartner,
  type SeasonResponse,
  api,
  formatMoscowHuman,
} from '@shared/index';
import { Alert, Button, SectionCard } from '@shared/index';
import { ORGANIZATION_JSON_LD, useSeo } from '@/lib/seo';

// Главная страница. Тексты — по Положению; бренд и оформление взяты из текущего
// визуального языка сайта. Разделы «Архив законопроектов» и «Документы» ведут
// к реальным данным из базы.

const STAGES = [
  {
    title: 'Отборочный этап',
    text: 'Заочно: экспертиза законотворческих инициатив онлайн-комиссией. Нужны текст законопроекта и пояснительная записка.',
  },
  {
    title: 'Первый этап',
    text: 'Дистанционно: видеопрезентация инициативы и команды во «ВКонтакте» с хэштегом #Лидеры_права_2027.',
  },
  {
    title: 'Второй (финальный) этап',
    text: 'Очно в Москве: групповые выступления, дебаты и Гранд-финал перед Жюри.',
  },
];

const BENEFITS = [
  { title: 'Стажировки', text: 'Ведущие юридические компании и органы власти для победителей и финалистов.' },
  { title: 'Наставники', text: 'Работа с экспертами: преподаватели, практикующие юристы, представители власти и бизнеса.' },
  { title: 'Публикация инициатив', text: 'Лучшие законопроекты направляются субъектам права законодательной инициативы.' },
  { title: 'Признание', text: 'Дипломы, публикации в сборниках и признание в профессиональном сообществе.' },
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

  const open = season?.season.is_application_open === true;
  const announced = masterclasses.filter((item) => item.status === 'announced');

  return (
    <main className="mx-auto flex max-w-container flex-col gap-12 px-6 py-12">
      {error ? <Alert tone="warning">{error}</Alert> : null}

      <section className="border-b border-border pb-10">
        <p className="mono-label text-muted">Сезон 2026/2027</p>
        <h1 className="mt-3 text-display font-semibold tracking-[var(--tr-display)]">
          Лидеры
          <br />
          права
        </h1>
        <p className="mt-5 max-w-measure text-lead">
          Десятый ежегодный федеральный научно-образовательный конкурс для студентов и молодых специалистов. Участие
          бесплатное: команда разрабатывает законотворческую инициативу, работает с наставниками и защищает её перед Жюри.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link to="/apply">
            <Button>Подать заявку</Button>
          </Link>
          <Link to="/documents">
            <Button variant="secondary">Документы конкурса</Button>
          </Link>
        </div>
        <dl className="mt-8 grid gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="mono-label text-muted">Приём заявок</dt>
            <dd className="mt-1">{formatMoscowHuman(season?.season.application_open_at ?? null)}</dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Окончание приёма</dt>
            <dd className="mt-1">{formatMoscowHuman(season?.season.application_close_at ?? null)}</dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Состояние</dt>
            <dd className="mt-1">{open ? 'приём открыт' : 'приём заявок завершён'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="stages-title">
        <h2 id="stages-title" className="text-h2 font-semibold">
          Этапы конкурса
        </h2>
        <div className="mt-5 grid gap-6 md:grid-cols-3">
          {STAGES.map((stage) => (
            <article key={stage.title} className="border border-border p-5">
              <h3 className="text-h3 font-semibold">{stage.title}</h3>
              <p className="mt-2 text-sm text-muted">{stage.text}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-sm">
          <Link to="/stages" className="text-accent underline underline-offset-2">
            Календарь и критерии оценки
          </Link>
        </p>
      </section>

      <section aria-labelledby="benefits-title">
        <h2 id="benefits-title" className="text-h2 font-semibold">
          Что получают участники
        </h2>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <article key={benefit.title} className="border-b border-border pb-4">
              <h3 className="text-h3 font-semibold">{benefit.title}</h3>
              <p className="mt-1 text-sm text-muted">{benefit.text}</p>
            </article>
          ))}
        </div>
      </section>

      {announced.length > 0 ? (
        <section aria-labelledby="masterclasses-title">
          <h2 id="masterclasses-title" className="text-h2 font-semibold">
            Ближайшие мастер-классы
          </h2>
          <ul className="mt-5 flex flex-col gap-4">
            {announced.map((item) => (
              <li key={item.id} className="border-b border-border pb-3">
                <p className="font-semibold">{item.title}</p>
                <p className="text-sm text-muted">
                  {item.speaker} · {formatMoscowHuman(item.starts_at)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <Link to="/masterclasses" className="text-accent underline underline-offset-2">
              Все мастер-классы
            </Link>
          </p>
        </section>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard title="Архив законопроектов" description="Инициативы, прошедшие конкурс: ориентир для новых участников.">
          <Link to="/initiatives" className="text-accent underline underline-offset-2">
            Открыть архив
          </Link>
        </SectionCard>
        <SectionCard title="Победители" description="Команды и номинации по годам.">
          <Link to="/winners" className="text-accent underline underline-offset-2">
            Смотреть победителей
          </Link>
        </SectionCard>
      </div>

      {partners.length > 0 ? (
        <section aria-labelledby="partners-title">
          <h2 id="partners-title" className="text-h2 font-semibold">
            Партнёры конкурса
          </h2>
          <ul className="mt-5 flex flex-wrap gap-6">
            {partners.map((partner) => (
              <li key={partner.id} className="border border-border p-4">
                {partner.logo_url ? (
                  <img src={partner.logo_url} alt={partner.name} className="h-12 w-auto object-contain" loading="lazy" />
                ) : null}
                <p className="mt-2 text-sm">{partner.name}</p>
                {partner.url ? (
                  <a href={partner.url} className="text-sm text-accent underline underline-offset-2">
                    Перейти на сайт партнёра
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted">
          Список партнёров публикуется после подтверждения согласия на размещение логотипов (вопрос Оргкомитету).
        </p>
      )}
    </main>
  );
}
