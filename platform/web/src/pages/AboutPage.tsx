import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type PublicPage, api } from '@shared/index';
import { SectionCard } from '@shared/index';
import { ORGANIZATION_JSON_LD, useSeo } from '@/lib/seo';

// «О конкурсе»: описание, учредитель, история и частые вопросы.
// Тексты берутся из редактируемых страниц (раздел «Страницы» в админке); пока
// Оргкомитет их не заполнил, показываются тексты по умолчанию.

const FAQ = [
  {
    question: 'Кто может участвовать в конкурсе?',
    answer:
      'Лица от 16 до 35 лет включительно на дату окончания приёма заявок: студенты, магистранты, аспиранты, молодые специалисты и руководители молодёжных объединений. Юридическое образование не обязательно.',
  },
  {
    question: 'Сколько человек в команде?',
    answer:
      'От 2 до 4 человек. Единоличное участие допускается по письменному согласованию с Оргкомитетом до окончания срока приёма заявок.',
  },
  {
    question: 'Участие платное?',
    answer: 'Нет. Участие бесплатное, организационный взнос не взимается.',
  },
  {
    question: 'Куда подавать заявку?',
    answer:
      'Только на этом сайте, через раздел «Подать заявку». Внешние формы и приём заявок по электронной почте не используются.',
  },
  {
    question: 'Нужно ли подписывать и загружать согласия?',
    answer:
      'Согласия оформляются электронно при подаче заявки: фиксируются дата, время, сетевой адрес и версия текста согласия. Исключение — согласие законного представителя для участников младше 18 лет: дополнительно нужен скан подписанного бланка.',
  },
  {
    question: 'Как узнать итоги этапа?',
    answer:
      'Протоколы публикуются на сайте. Баллы участника видны в личном кабинете команды. Срок подачи апелляций — два рабочих дня с момента опубликования протокола этапа.',
  },
];

export function AboutPage() {
  const [page, setPage] = useState<PublicPage | null>(null);

  useSeo({
    title: 'О конкурсе',
    description:
      'О Десятом ежегодном федеральном научно-образовательном конкурсе «Лидеры права – 2027»: учредитель, цели, история конкурса и ответы на частые вопросы.',
    path: '/about',
    jsonLd: ORGANIZATION_JSON_LD,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.page('about');
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
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">О конкурсе</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">
          {page?.title ?? 'Десятый конкурс «Лидеры права – 2027»'}
        </h1>
      </header>

      <SectionCard title="О конкурсе" description="Описание и цели конкурса.">
        {page?.body ? (
          <div className="flex max-w-measure flex-col gap-3 text-sm whitespace-pre-line">{page.body}</div>
        ) : (
          <div className="flex max-w-measure flex-col gap-3 text-sm">
            <p>
              «Лидеры права» — ежегодный федеральный научно-образовательный конкурс для студентов и молодых
              специалистов. Конкурс развивает законотворческую культуру: команды готовят собственные законопроекты,
              работают с наставниками и защищают инициативы перед экспертами и Жюри.
            </p>
            <p>
              Конкурс проводится с 2017 года. Десятый сезон — «Лидеры права – 2027» — проходит с 11 ноября 2026 года по
              июнь 2027 года: отборочный и первый этапы дистанционно, финал — очно в Москве.
            </p>
            <p>
              Лучшие инициативы направляются субъектам права законодательной инициативы и публикуются в{' '}
              <Link to="/initiatives" className="text-accent underline underline-offset-2">
                архиве законопроектов
              </Link>
              .
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Учредитель" description="Оператор персональных данных конкурса.">
        <p className="max-w-measure text-sm">
          Межрегиональная общественная организация выпускников Саратовской государственной юридической академии
          «Ассоциация выпускников СЮИ – СГАП – СГЮА». ОГРН 1087799025522, ИНН 7701360798. Юридический адрес: 107078,
          г. Москва, ул. Мясницкая, д. 48.
        </p>
        <p className="mt-3 text-sm">
          <Link to="/contacts" className="text-accent underline underline-offset-2">
            Контакты Оргкомитета
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="История конкурса" description="Сезоны 2017–2026.">
        <p className="max-w-measure text-sm">
          Итоги прошлых сезонов публикуются в разделе{' '}
          <Link to="/winners" className="text-accent underline underline-offset-2">
            «Победители»
          </Link>
          . Архив инициатив прошлых лет пополняется по мере подтверждения согласий участников.
        </p>
      </SectionCard>

      <SectionCard title="Частые вопросы" description="Ответы по Положению о конкурсе.">
        <dl className="flex flex-col gap-5">
          {FAQ.map((item) => (
            <div key={item.question}>
              <dt className="font-medium">{item.question}</dt>
              <dd className="mt-1 max-w-measure text-sm text-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <p className="text-sm text-muted">
        Правовая основа:{' '}
        <Link to="/documents" className="text-accent underline underline-offset-2">
          Положение о конкурсе и Приложения № 1–14
        </Link>
        .
      </p>
    </main>
  );
}
