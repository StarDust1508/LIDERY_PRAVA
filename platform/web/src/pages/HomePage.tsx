import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type PublicMasterclass,
  type PublicPartner,
  type SeasonResponse,
  api,
  formatMoscowDate,
  formatMoscowHuman,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ORGANIZATION_JSON_LD, useSeo } from '@/lib/seo';

// Главная страница конкурса.
//
// Композиция и классы — прежнего сайта: hero с фотографией, манифест, «Цифры
// сезона», «История проекта», «Этапы», «Что вы получите», «Партнёры», блок подачи
// заявки, «Вопросы и ответы» и финальный призыв. Содержание — по Положению и из
// базы: сроки, мастер-классы, партнёры.

const STAGES = [
  {
    title: 'Отборочный этап',
    text: 'Дистанционно: экспертиза законотворческих инициатив Конкурсной комиссией. Нужны текст законопроекта и пояснительная записка.',
  },
  {
    title: 'Первый этап',
    text: 'Дистанционно: видеопрезентация инициативы и команды во «ВКонтакте», оценка видеороликов и материалов этапа.',
  },
  {
    title: 'Второй (финальный) этап',
    text: 'Очно в Москве: групповые выступления, дебаты и Гранд-финал перед Жюри.',
  },
];

const BENEFITS = [
  {
    title: 'Наставничество',
    text: 'Работа с экспертами: преподаватели, практикующие юристы, представители органов власти и бизнеса.',
    image: '/assets/benefits-person.jpg',
  },
  {
    title: 'Стажировки',
    text: 'Ведущие юридические компании и органы власти для победителей и финалистов.',
    image: '/assets/timeline-2025.jpg',
  },
  {
    title: 'Публикация инициатив',
    text: 'Лучшие законопроекты направляются субъектам права законодательной инициативы и попадают в архив.',
    image: '/assets/timeline-2024.jpg',
  },
  {
    title: 'Публичность',
    text: 'Защита инициативы перед экспертным сообществом и освещение в сообществе конкурса.',
    image: '/assets/timeline-2022.jpg',
  },
  {
    title: 'Нетворкинг',
    text: 'Знакомства с участниками, наставниками и членами Конкурсной комиссии из разных регионов.',
    image: '/assets/timeline-2020.jpg',
  },
];

const HISTORY = [
  { year: '2017', image: '/assets/timeline-2017.jpg', text: 'Первый сезон конкурса: заявки студентов и первые законотворческие инициативы.' },
  { year: '2019', image: '/assets/timeline-2019.jpg', text: 'Конкурс выходит за пределы одного региона, появляются наставники-практики.' },
  { year: '2020', image: '/assets/timeline-2020.jpg', text: 'Дистанционный формат этапов и работа команд из разных субъектов Российской Федерации.' },
  { year: '2022', image: '/assets/timeline-2022.jpg', text: 'Инициативы участников направляются субъектам права законодательной инициативы.' },
  { year: '2024', image: '/assets/timeline-2024.jpg', text: 'Финал в Москве: групповые выступления, дебаты и Гранд-финал.' },
  { year: '2025', image: '/assets/timeline-2025.jpg', text: 'Девятый сезон: расширение состава Конкурсной комиссии и партнёрской программы.' },
];

const FAQ = [
  {
    question: 'Кто может участвовать в конкурсе?',
    answer: 'Лица от 16 до 35 лет включительно на дату окончания приёма заявок. Юридическое образование не обязательно.',
    path: '/about/faq',
  },
  {
    question: 'Сколько человек в команде?',
    answer: 'От 2 до 4 человек. Единоличное участие — по письменному согласованию с Оргкомитетом.',
    path: '/participants/requirements',
  },
  {
    question: 'Куда подавать заявку?',
    answer: 'Только на этом сайте, в разделе «Подать заявку». Внешние формы не используются.',
    path: '/apply',
  },
  {
    question: 'Нужно ли загружать подписанные согласия?',
    answer: 'Согласия оформляются электронно при подаче заявки. Исключение — участники младше 18 лет: нужен скан согласия законного представителя.',
    path: '/legal/pdn-consent-minor',
  },
  {
    question: 'Как узнать итоги этапа?',
    answer: 'Протоколы публикуются на сайте, баллы видны в личном кабинете. Срок подачи апелляции — два рабочих дня с момента опубликования протокола.',
    path: '/stages/appeals',
  },
];

/** Строка «Вопросы и ответы»: разметка прежнего сайта (кнопка + ответ). */
function FaqRow({ item, index }: { item: { question: string; answer: string; path: string }; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item${open ? ' open' : ''}`}>
      <button
        type="button"
        className="faq-question"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="faq-num">{String(index + 1).padStart(2, '0')}</span>
        <span className="faq-q-text">{item.question}</span>
        <span className="faq-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </span>
      </button>
      <div className="faq-answer" style={{ maxHeight: open ? '24rem' : 0 }}>
        <p>{item.answer}</p>
        <p>
          <Link to={item.path}>Подробнее →</Link>
        </p>
      </div>
    </div>
  );
}

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
  const deadlineLabel = open
    ? `Приём заявок открыт до ${formatMoscowHuman(seasonInfo?.application_close_at ?? null)}`
    : notStarted
      ? `Приём заявок откроется ${formatMoscowHuman(seasonInfo?.application_open_at ?? null)}`
      : `Приём заявок завершён ${formatMoscowDate(seasonInfo?.application_close_at ?? null)}`;

  return (
    <>
      {error ? (
        <div className="wrap" style={{ paddingTop: '1.5rem' }}>
          <Alert tone="warning">{error}</Alert>
        </div>
      ) : null}

      {/* Первый экран: плакат слева, фотография финала справа. */}
      <header className="hero" id="home">
        <div className="hero-left">
          <div className="hero-topmeta mono">
            <span>Юридический конкурс — Россия</span>
            <span>2017—2027</span>
          </div>
          <h1 aria-label="Лидеры права">
            Лидеры
            <br />
            <span className="red">права</span>
          </h1>
          <div className="hero-photo-band">
            <div className="duo">
              <img
                src="/assets/timeline-2024.jpg"
                alt="Финал конкурса «Лидеры права» 2024 года"
                width={1280}
                height={854}
                loading="eager"
              />
            </div>
            <div className="tag mono">[ Финал · 2024 ]</div>
          </div>
          <div className="hero-bottom">
            <p className="hero-statement">
              Конкурс, который превращает <b>заявку студента</b> в карьеру юриста — через отбор, наставников,
              стажировки и публикацию законотворческих инициатив.
            </p>
          </div>
        </div>
        <div className="hero-photo">
          <div className="duo">
            <img
              src="/assets/timeline-2024.jpg"
              alt="Финал конкурса «Лидеры права» 2024 года"
              width={1280}
              height={854}
              loading="eager"
            />
          </div>
          <div className="tag mono">[ Финал · 2024 ]</div>
        </div>
      </header>

      {/* Манифест: одна мысль на весь экран. */}
      <section className="block manifesto" id="manifesto">
        <div className="wrap">
          <div className="sec-label mono">(О конкурсе)</div>
          <p>
            Право <span className="red">начинается</span> с тех, кто <span className="mute">не боится</span> взять слово.
          </p>
        </div>
      </section>

      {/* Цифры сезона. */}
      <section className="block sand" id="stats">
        <div className="wrap">
          <div className="sec-label mono">(Цифры сезона)</div>
          <div className="stats">
            <div className="stat">
              <div className="num">2017</div>
              <div className="lbl mono">Год основания</div>
            </div>
            <div className="stat">
              <div className="num">
                <span className="red">10</span>
              </div>
              <div className="lbl mono">Сезон конкурса</div>
            </div>
            <div className="stat">
              <div className="num">70</div>
              <div className="lbl mono">Баллов отборочного этапа</div>
            </div>
            <div className="stat">
              <div className="num">2–4</div>
              <div className="lbl mono">Человека в команде</div>
            </div>
          </div>
        </div>
      </section>

      {/* История проекта: фотолента по годам. */}
      <section className="block" id="story">
        <div className="wrap">
          <div className="sec-label mono">(История проекта / 2017—2025)</div>
          <div className="story-grid">
            {HISTORY.map((item, index) => (
              <Link
                key={item.year}
                to="/about/history"
                className={`pcard ${['s-a', 's-b', 's-c', 's-b', 's-a', 's-c'][index] ?? 's-c'}`}
              >
                <div className={`duo${index % 3 === 2 ? ' ink' : ''}`}>
                  <img src={item.image} alt={`Конкурс «Лидеры права» в ${item.year} году`} loading="lazy" />
                </div>
                <div className="meta">
                  <span className="pyear">{item.year}</span>
                  <span className="pdesc mono">{item.text}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="story-cta">
            <Link to="/winners" className="story-link mono">
              Победители прошлых сезонов →
            </Link>
          </div>
        </div>
      </section>

      {/* Этапы: маршрут участника. */}
      <section className="block sand" id="stages">
        <div className="wrap">
          <div className="sec-label mono">(Этапы / маршрут участника)</div>
          <div className="benefits-grid">
            {STAGES.map((stage) => (
              <article key={stage.title} className="bcard">
                <h3>{stage.title}</h3>
                <p>{stage.text}</p>
              </article>
            ))}
          </div>
          <p style={{ marginTop: '1.5rem' }}>
            <Link to="/stages">Календарь, критерии оценки и апелляции →</Link>
          </p>
        </div>
      </section>

      {/* Что получают участники. */}
      <section className="block" id="benefits">
        <div className="wrap">
          <div className="sec-label mono">(Что вы получите / после конкурса)</div>
          <div className="benefits-grid">
            {BENEFITS.map((benefit) => (
              <article key={benefit.title} className="bcard">
                <div className="duo bcard-photo">
                  <img src={benefit.image} alt="" loading="lazy" />
                </div>
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Партнёры. */}
      <section className="block sand" id="partners">
        <div className="wrap">
          <div className="sec-label mono">(Партнёры / нам доверяют)</div>
          {partners.length > 0 ? (
            <div className="partners-grid">
              {partners.map((partner) => (
                <article key={partner.id} className="bcard">
                  {partner.logo_url ? (
                    <div className="duo bcard-photo">
                      <img src={partner.logo_url} alt={`Логотип: ${partner.name}`} loading="lazy" />
                    </div>
                  ) : null}
                  <h3>{partner.name}</h3>
                  {partner.description ? <p>{partner.description}</p> : null}
                  {partner.url ? (
                    <a href={partner.url} target="_blank" rel="noopener noreferrer">
                      Сайт партнёра →
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="partners-grid">
              <article className="bcard">
                <h3>Ассоциация выпускников СЮИ – СГАП – СГЮА</h3>
                <p>Учредитель конкурса. Утверждает Положение, состав органов конкурса и выступает оператором персональных данных.</p>
              </article>
              <article className="bcard">
                <h3>Ассоциация юристов России</h3>
                <p>Генеральный партнёр конкурса. Остальные партнёры публикуются после утверждения списка Оргкомитетом.</p>
              </article>
            </div>
          )}
        </div>
      </section>

      {/* Подать заявку: тёмный блок прежнего сайта. */}
      <section className="block apply" id="apply">
        <div className="wrap">
          <div className="sec-label mono">(Подать заявку)</div>
          <div className="apply-grid">
            <div className="apply-info">
              <h2>
                Подать
                <br />
                <span className="red">заявку</span>
              </h2>
              <p>
                Заявка заполняется на сайте по шагам: команда и инициатива, участники, наставники, конкурсные материалы и
                согласия. Черновик сохраняется — заполнение можно прервать и продолжить.
              </p>
              <span className="badge mono">{deadlineLabel}</span>
            </div>
            <div className="reveal">
              <Link to="/apply" className="cta-big">
                Заполнить
                <sup>↗</sup>
              </Link>
              <ul className="apply-list">
                <li>
                  <Link to="/participants/requirements">Требования к участникам</Link>
                </li>
                <li>
                  <Link to="/participants/materials">Конкурсные материалы</Link>
                </li>
                <li>
                  <Link to="/about/regulations">Положение и приложения</Link>
                </li>
                <li>
                  <Link to="/about/faq">Частые вопросы</Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Мастер-классы: добавляются, когда Оргкомитет публикует анонсы. */}
      {announced.length > 0 ? (
        <section className="block">
          <div className="wrap">
            <div className="sec-label mono">(Мастер-классы / для финалистов)</div>
            <div className="benefits-grid">
              {announced.map((item) => (
                <article key={item.id} className="bcard">
                  <h3>{item.title}</h3>
                  <p>
                    {item.speaker}
                    <br />
                    {formatMoscowHuman(item.starts_at)}
                  </p>
                  <Link to={`/masterclasses/${item.slug ?? `masterclass-${item.id}`}`}>Подробнее →</Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Вопросы и ответы. */}
      <section className="block" id="faq">
        <div className="wrap">
          <div className="sec-label mono">(Вопросы и ответы)</div>
          <div className="faq-shell">
            <div className="faq-head">
              <h2>
                Вопросы
                <br />и ответы
              </h2>
            </div>
            <div className="faq-list">
              {FAQ.map((item, index) => (
                <FaqRow key={item.question} item={item} index={index} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Финальный призыв. */}
      <section className="cta" id="cta">
        <div className="wrap">
          <div className="sec-label mono">(Подать заявку)</div>
          <Link to="/apply" className="cta-big">
            Стать
            <br />
            лидером
            <sup>↗</sup>
          </Link>
        </div>
      </section>
    </>
  );
}
