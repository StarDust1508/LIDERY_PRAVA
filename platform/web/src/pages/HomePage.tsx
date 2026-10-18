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
import { DecadeScale } from '@/components/DecadeScale';
import { CountUp } from '@/components/CountUp';
import { SpotlightCard } from '@/components/SpotlightCard';
import { Arc, ArrowRight, ArrowUpRight } from '@/components/Icon';
import { ORGANIZATION_JSON_LD, useSeo } from '@/lib/seo';

// Главная страница конкурса.
//
// Композиция — прежнего сайта: первый экран с плакатом, манифест, «Цифры сезона»,
// «История проекта», «Этапы», «Что Вы получите», «Партнёры», блок подачи заявки,
// «Вопросы и ответы» и финальный призыв. Содержание — по Положению и из базы.
//
// Что изменено против прежней вёрстки и почему:
//   • справа на первом экране вместо вертикально обрезанного группового снимка —
//     летопись «2017—2027» (анимация) и кадр финала в родной пропорции 3:2;
//   • в карточках «Что Вы получите» остался один портрет (наставничество), у
//     остальных — номер и линия: те же фотографии уже показаны в «Истории
//     проекта», и повторять их дважды на одной странице было бессмысленно;
//   • блоки появляются при прокрутке (класс .reveal, см. lib/reveal.ts).

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
  },
  {
    title: 'Публикация инициатив',
    text: 'Лучшие законопроекты направляются субъектам права законодательной инициативы и попадают в архив.',
  },
  {
    title: 'Публичность',
    text: 'Защита инициативы перед экспертным сообществом и освещение в сообществе конкурса.',
  },
  {
    title: 'Нетворкинг',
    text: 'Знакомства с участниками, наставниками и членами Конкурсной комиссии из разных регионов.',
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
          <Link to={item.path}>
            Подробнее
            <ArrowRight size={15} />
          </Link>
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

  const marqueeItems = [
    'Десятый сезон конкурса',
    deadlineLabel,
    'Финал в Москве',
    'Наставники-практики',
    'Публикация законотворческих инициатив',
  ];

  return (
    <>
      {error ? (
        <div className="wrap" style={{ paddingTop: '1.5rem' }}>
          <Alert tone="warning">{error}</Alert>
        </div>
      ) : null}

      {/* Первый экран: плакат и действия слева, летопись конкурса справа. */}
      <header className="hero" id="home">
        <div className="hero-left">
          <div className="hero-topmeta mono">
            <span>Юридический конкурс — Россия</span>
            <span>2017—2027</span>
          </div>
          {/* Заголовок по словам: каждое появляется со своей задержкой (приём
              SplitText из reactbits.dev). Текст остаётся обычным текстом в DOM:
              поиск и скринридеры видят «Лидеры права» целиком. */}
          <h1 aria-label="Лидеры права">
            <span className="hero-word" style={{ '--d': '0ms' } as React.CSSProperties}>
              Лидеры
            </span>
            <br />
            <span className="hero-word red" style={{ '--d': '120ms' } as React.CSSProperties}>
              права
            </span>
          </h1>
          <div className="hero-bottom">
            <p className="hero-statement">
              Конкурс, который превращает <b>заявку студента</b> в карьеру юриста — через отбор, наставников,
              стажировки и публикацию законотворческих инициатив.
            </p>
            <div className="hero-actions">
              <Link to="/apply" className="btn btn-solid mono">
                Подать заявку
                <ArrowUpRight size={16} />
              </Link>
              <Link to="/participants" className="btn btn-ghost mono">
                Как участвовать
              </Link>
            </div>
          </div>
        </div>

        {/* Правая колонка: шкала «2017—2027» и кадр финала в родной пропорции. */}
        <div className="hero-side">
          <DecadeScale />
          <div className="hero-photo-band">
            <div className="duo">
              <img
                src="/assets/timeline-2024.jpg"
                alt="Участники и организаторы финала конкурса «Лидеры права» 2024 года"
                width={1280}
                height={854}
                loading="eager"
              />
            </div>
            <div className="tag mono">[ Финал · 2024 ]</div>
          </div>
        </div>
      </header>

      {/* Бегущая строка: сроки и суть конкурса одной полосой. */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <span key={copy}>
              {marqueeItems.map((item) => (
                <b key={item}>{item}</b>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* Манифест: одна мысль на весь экран. */}
      <section className="block manifesto arc-left" id="manifesto">
        <Arc className="arc" />
        <div className="wrap">
          <div className="sec-label mono">(О конкурсе)</div>
          <p className="reveal">
            Право <span className="red">начинается</span> с тех, кто <span className="mute">не боится</span> взять слово.
          </p>
        </div>
      </section>

      {/* Цифры сезона. */}
      <section className="block sand" id="stats">
        <div className="wrap">
          <div className="sec-label mono">(Цифры сезона)</div>
          <div className="stats reveal">
            <div className="stat">
              <div className="num"><CountUp value="2017" /></div>
              <div className="lbl mono">Год основания</div>
            </div>
            <div className="stat">
              <div className="num">
                <span className="red">
                  <CountUp value="10" />
                </span>
              </div>
              <div className="lbl mono">Сезон конкурса</div>
            </div>
            <div className="stat">
              <div className="num"><CountUp value="70" /></div>
              <div className="lbl mono">Баллов отборочного этапа</div>
            </div>
            <div className="stat">
              <div className="num"><CountUp value="2–4" /></div>
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
              <SpotlightCard key={item.year} className="reveal">
                <Link
                  to="/about/history"
                  className="pcard"
                  style={{ '--d': `${index * 80}ms` } as React.CSSProperties}
                >
                {/* Фотолента: кадры в естественном цвете — чернильная подложка
                    «каждой третьей» карточки отменена правкой от 12.10.2026. */}
                <div className="duo">
                  <img
                    src={item.image}
                    alt={`Участники конкурса «Лидеры права» в ${item.year} году`}
                    width={1280}
                    height={854}
                    loading="lazy"
                  />
                </div>
                <div className="meta">
                  <span className="pyear">{item.year}</span>
                  <span className="pdesc mono">{item.text}</span>
                </div>
                </Link>
              </SpotlightCard>
            ))}
          </div>
          <div className="story-cta reveal">
            <Link to="/winners" className="story-link mono">
              Победители прошлых сезонов
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* Этапы: маршрут участника. */}
      <section className="block sand" id="stages">
        <div className="wrap">
          <div className="sec-label mono">(Этапы / маршрут участника)</div>
          <div className="benefits-grid">
            {STAGES.map((stage, index) => (
              <article
                key={stage.title}
                className="bcard reveal"
                style={{ '--d': `${index * 90}ms` } as React.CSSProperties}
              >
                <span className="bcard-num mono">{String(index + 1).padStart(2, '0')}</span>
                <h3>{stage.title}</h3>
                <p>{stage.text}</p>
              </article>
            ))}
          </div>
          <p className="reveal" style={{ marginTop: '1.5rem' }}>
            <Link to="/stages">
              Календарь, критерии оценки и апелляции
              <ArrowRight size={15} />
            </Link>
          </p>
        </div>
      </section>

      {/* Что получают участники. */}
      <section className="block" id="benefits">
        <div className="wrap">
          <div className="sec-label mono">(Что Вы получите / после конкурса)</div>
          <div className="benefits-grid">
            {BENEFITS.map((benefit, index) => (
              <article
                key={benefit.title}
                className="bcard reveal"
                style={{ '--d': `${index * 80}ms` } as React.CSSProperties}
              >
                {benefit.image ? (
                  <div className="duo bcard-photo portrait">
                    <img
                      src={benefit.image}
                      alt="Наставник конкурса «Лидеры права»"
                      width={640}
                      height={640}
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <span className="bcard-num mono">{String(index + 1).padStart(2, '0')}</span>
                )}
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
            <div className="partners-grid reveal">
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
                      Сайт партнёра
                      <ArrowUpRight size={14} />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="partners-grid reveal">
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
          <hr className="neon-line" />
          <div className="apply-grid reveal">
            <div className="apply-info">
              <h2>
                Подать
                <br />
                <span className="red">заявку</span>
              </h2>
              <p>
                Заявка заполняется на сайте по шагам: команда и инициатива, участники, наставники, конкурсные
                материалы и согласия. Черновик сохраняется — заполнение можно прервать и продолжить.
              </p>
              <span className="badge mono">{deadlineLabel}</span>
            </div>
            <div>
              <Link to="/apply" className="cta-big">
                Заполнить
                <span className="cta-icon" aria-hidden="true">
                  <ArrowUpRight size={30} />
                </span>
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
            <div className="benefits-grid reveal">
              {announced.map((item) => (
                <article key={item.id} className="bcard">
                  <h3>{item.title}</h3>
                  <p>
                    {item.speaker}
                    <br />
                    {formatMoscowHuman(item.starts_at)}
                  </p>
                  <Link to={`/masterclasses/${item.slug ?? `masterclass-${item.id}`}`}>
                    Подробнее
                    <ArrowRight size={15} />
                  </Link>
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
          <div className="faq-shell reveal">
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
          <Link to="/apply" className="cta-big reveal">
            Стать
            <br />
            лидером
            <span className="cta-icon" aria-hidden="true">
              <ArrowUpRight size={34} />
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}
