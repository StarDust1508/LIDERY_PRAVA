import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type PublicPage, type Season, api, formatMoscowHuman, pluralize } from '@shared/index';
import { PageHeader, Prose, Section } from '@/components/PageBlocks';
import { useSeason } from '@/lib/season';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Частые вопросы (ТЗ 08, п. 2.1; ТЗ 02, п. 12).
//
// Ответы опираются на Положение о конкурсе. Сроки не хранятся в тексте: они
// подставляются из активного сезона и показываются с пометкой МСК. Разметка
// FAQPage в schema.org собирается из тех же вопросов и ответов, поэтому текст
// ответов — обычные строки без разметки.

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ: FaqItem[] = [
  {
    id: 'who',
    question: 'Кто может участвовать в конкурсе?',
    answer:
      'Лица от 16 до 35 лет включительно на дату окончания приёма заявок: студенты, магистранты, аспиранты, молодые специалисты и руководители молодёжных объединений. Юридическое образование не обязательно.',
  },
  {
    id: 'team-size',
    question: 'Сколько человек в команде?',
    answer:
      'От 2 до 4 человек. Единоличное участие допускается по письменному согласованию с Оргкомитетом до окончания срока приёма заявок.',
  },
  {
    id: 'fee',
    question: 'Участие платное?',
    answer: 'Нет. Участие бесплатное, организационный взнос не взимается.',
  },
  {
    id: 'solo',
    question: 'Можно ли участвовать одному, без команды?',
    answer:
      'Да. Единоличное участие допускается по согласованию с Оргкомитетом, в том числе оформленному электронно: в заявке отмечается единоличное участие и указывается дата согласования. Такой участник выступает как капитан команды, состоящей из одного человека, и подаёт те же конкурсные материалы.',
  },
  {
    id: 'apply',
    question: 'Как подать заявку и куда?',
    answer:
      'Заявка подаётся только на этом сайте, в разделе «Подать заявку»: это единственный канал приёма. Заявка считается поданной с момента поступления в электронную форму. Внешние формы и приём заявок по электронной почте не используются.',
  },
  {
    id: 'schedule',
    question: 'В какие сроки проходят этапы?',
    answer: 'Сроки этапов ведутся в системе Оргкомитета и публикуются в разделе «Календарь».',
  },
  {
    id: 'consents',
    question: 'Какие согласия нужны при подаче заявки?',
    answer:
      'Согласия оформляются электронно при подаче заявки: система фиксирует дату, время, сетевой адрес и версию текста согласия. Согласие на обработку персональных данных и согласие на распространение оформляются отдельно друг от друга. Без согласия на обработку персональных данных участие невозможно.',
  },
  {
    id: 'minors',
    question: 'Что с согласиями для участников младше 18 лет?',
    answer:
      'Дополнительно требуется письменное согласие законного представителя (Приложение № 11): скан подписанного бланка загружается в конкурсных материалах. Фотографии и видеозаписи несовершеннолетних публикуются только при наличии такого согласия.',
  },
  {
    id: 'personal-data',
    question: 'Что с персональными данными и распространением?',
    answer:
      'Оператор персональных данных — Ассоциация выпускников СЮИ – СГАП – СГЮА. Согласие можно отозвать в любое время; отзыв до завершения конкурса прекращает участие. Базы данных с персональными данными граждан России размещаются на территории Российской Федерации. Фамилия, имя, отчество, организация и результаты участия публикуются только при согласии на распространение; без него карточка публикуется обезличенно.',
  },
  {
    id: 'materials-change',
    question: 'Можно ли менять конкурсные материалы после срока?',
    answer:
      'Изменение содержания законотворческой инициативы после окончания приёма заявок запрещено (п. 7.5 Положения). Если недостатки оформления устранимы, Оргкомитет однократно предлагает устранить их в срок не более двух рабочих дней.',
  },
  {
    id: 'results',
    question: 'Как узнать результаты и подать апелляцию?',
    answer:
      'Протоколы этапов публикуются на сайте, баллы участника видны в личном кабинете команды. Апелляцию подаёт капитан команды по форме Приложения № 14 в течение двух рабочих дней с момента публикации протокола этапа.',
  },
  {
    id: 'not-allowed',
    question: 'Кого не допускают к участию?',
    answer:
      'Победителей I места прошлых лет; членов Оргкомитета, комиссий, Жюри и экспертов, а также их супругов и близких родственников; участников, представивших недостоверные сведения.',
  },
];

/** Сроки этапов: только из активного сезона, с пометкой МСК у каждого времени. */
function scheduleAnswer(season: Season | null): string {
  if (!season) {
    return 'Сроки этапов текущего сезона ведутся в системе Оргкомитета и публикуются в разделе «Календарь».';
  }
  const parts: string[] = [];
  if (season.application_open_at || season.application_close_at) {
    parts.push(
      `Приём заявок и конкурсных материалов отборочного этапа: ${period(
        season.application_open_at,
        season.application_close_at
      )}.`
    );
  }
  if (season.tech_check_from || season.tech_check_to) {
    parts.push(`Техническая проверка: ${period(season.tech_check_from, season.tech_check_to)}.`);
  }
  if (season.stage1_from || season.stage1_to) {
    parts.push(`Первый этап: ${period(season.stage1_from, season.stage1_to)}.`);
  }
  if (season.final_from || season.final_to) {
    parts.push(`Второй (финальный) этап: ${period(season.final_from, season.final_to)}.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Сроки этапов публикуются в разделе «Календарь».';
}

function period(from: string | null, to: string | null): string {
  if (from && to) return `с ${formatMoscowHuman(from)} до ${formatMoscowHuman(to)}`;
  if (to) return `до ${formatMoscowHuman(to)}`;
  if (from) return `с ${formatMoscowHuman(from)}`;
  return 'уточняются';
}

/** Срок апелляции — из настроек сезона, а не из текста страницы. */
function resultsAnswer(season: Season | null): string {
  const days = season?.appeal_window_days ?? 2;
  const window = pluralize(days, ['рабочий день', 'рабочих дня', 'рабочих дней']);
  return `Протоколы этапов публикуются на сайте, баллы участника видны в личном кабинете команды. Апелляцию подаёт капитан команды по форме Приложения № 14 в течение ${window} с момента публикации протокола этапа. Решения второго (финального) этапа по итогам голосования обжалованию не подлежат.`;
}

/** Узел BreadcrumbList без @context: в @graph контекст задаётся один раз. */
function breadcrumbNode(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  const node = breadcrumbs(items);
  delete node['@context'];
  return node;
}

export function FaqPage() {
  const { data: seasonData } = useSeason();
  const season: Season | null = seasonData?.season ?? null;
  const [page, setPage] = useState<PublicPage | null>(null);

  const items = FAQ.map((item) => {
    if (item.id === 'schedule') return { ...item, answer: scheduleAnswer(season) };
    if (item.id === 'results') return { ...item, answer: resultsAnswer(season) };
    return item;
  });

  useSeo({
    title: page?.seo_title ?? 'Частые вопросы',
    description:
      page?.seo_description ??
      'Ответы на частые вопросы об участии в конкурсе «Лидеры\u00A0права\u00A0– 2027»: сроки этапов, состав команды, подача заявки, согласия и персональные данные, апелляции.',
    path: '/about/faq',
    // Два самостоятельных узла schema.org: хлебные крошки страницы и разметка
    // FAQPage из вопросов и ответов, которые видит читатель.
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        breadcrumbNode([
          { name: 'Главная', path: '/' },
          { name: 'О конкурсе', path: '/about' },
          { name: 'Частые вопросы', path: '/about/faq' },
        ]),
        {
          '@type': 'FAQPage',
          mainEntity: items.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        },
      ],
    },
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.page('about-faq');
        if (active) setPage(data);
      } catch {
        // Страница ещё не заполнена в админке — показываем текст по умолчанию.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="О конкурсе"
        title={page?.title ?? 'Частые вопросы'}
        lead="Короткие ответы по Положению о конкурсе: участие, сроки, конкурсные материалы, согласия и апелляции."
      />

      {page?.body ? (
        <Section title="О разделе" description="Текст, подготовленный Оргкомитетом.">
          <Prose>
            <p className="whitespace-pre-line">{page.body}</p>
          </Prose>
        </Section>
      ) : null}

      <Section title="Вопросы и ответы" description="Ответы соответствуют действующей редакции Положения.">
        <dl className="flex max-w-measure flex-col gap-6">
          {items.map((item) => (
            <div key={item.id} id={item.id} className="scroll-mt-24 border-b border-border pb-5 last:border-b-0 last:pb-0">
              <dt className="text-h3 font-semibold">
                {item.question}{' '}
                <a
                  href={`#${item.id}`}
                  aria-label={`Постоянная ссылка на вопрос: ${item.question}`}
                  className="mono-label text-muted no-underline hover:text-accent"
                >
                  #
                </a>
              </dt>
              <dd className="mt-2 text-sm text-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <p className="text-sm text-muted">
        Не нашли ответ? Напишите на{' '}
        <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
          lidery.prava@mail.ru
        </a>
        . Правила участия — в{' '}
        <Link to="/about/regulations" className="text-accent underline underline-offset-2">
          Положении о конкурсе
        </Link>
        ; права и обязанности сторон — в разделе{' '}
        <Link to="/documents" className="text-accent underline underline-offset-2">
          «Документы»
        </Link>
        .
      </p>
    </main>
  );
}
