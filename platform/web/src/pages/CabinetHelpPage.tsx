import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '@shared/index';
import { Alert, Button } from '@shared/index';
import { useSeason } from '@/lib/season';
import { useSeo } from '@/lib/seo';
import {
  type CabinetData,
  CabinetAppealForm,
  CabinetContactForm,
  CabinetLayout,
  CabinetLoadError,
  CabinetLoading,
  CabinetSection,
  CabinetSessionLost,
  fetchCabinetData,
} from './CabinetActions';

// Раздел личного кабинета «Помощь» (ТЗ 06, п. 2.4): контакты Оргкомитета, ответы на
// частые вопросы, форма обращения и апелляция по итогам этапа.
//
// Контакты берутся из данных сезона, а не из вёрстки: значения задаёт
// Оргкомитет, и они обязаны совпадать с публичной страницей «Контакты».

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ: FaqItem[] = [
  {
    question: 'Как войти в личный кабинет, если ссылка доступа потеряна?',
    answer:
      'Войдите по номеру заявки и адресу электронной почты капитана команды на странице входа. Если почта менялась, напишите в Оргкомитет: он подтвердит команду и выдаст ссылку доступа заново.',
  },
  {
    question: 'Срок приёма материалов истёк, но нужно исправить замечание. Что делать?',
    answer:
      'Выберите в форме обращения тему «Связь по дедлайну» и опишите, какой материал и по какому замечанию нужно досдать. Оргкомитет решает вопрос о досдаче; до его решения изменение материалов в личном кабинете закрыто, а чтение комплекта доступно.',
  },
  {
    question: 'Как заменить уже загруженный материал?',
    answer:
      'Откройте раздел «Конкурсные материалы» и загрузите новую версию: прежние версии сохраняются в истории с замечаниями и датами. Срок хранения версий определяет Оргкомитет.',
  },
  {
    question: 'Почему нельзя изменить состав команды?',
    answer:
      'Состав меняется до публикации итогов отборочного этапа и однократно, с сохранением не менее половины прежнего состава (п. 4.5 Положения). После этого изменения возможны только по решению Оргкомитета: болезнь, призыв или иные уважительные причины.',
  },
  {
    question: 'Как подать апелляцию по итогам этапа?',
    answer:
      'Апелляция подаётся капитаном команды по форме Приложения № 14 в течение двух рабочих дней с момента опубликования протокола этапа (п. 12.1 Положения) — форма ниже. Решения второго (финального) этапа не обжалуются.',
  },
  {
    question: 'Придут ли письма о сроках и замечаниях?',
    answer:
      'Почтовые рассылки конкурс не отправляет: о сроках команда узнаёт в разделе «Дедлайны» и по обратному отсчёту на сводке, а замечания появляются в разделе «Конкурсные материалы». Контактные данные капитана команды Оргкомитет видит в карточке заявки.',
  },
  {
    question: 'Как завершить доступ к личному кабинету с чужого устройства?',
    answer:
      'В личном кабинете есть кнопка «Завершить все сеансы»: она разрывает вход во всех браузерах. После этого команда входит заново по номеру заявки и почте капитана или по ссылке доступа от Оргкомитета.',
  },
];

export function CabinetHelpPage() {
  useSeo({
    title: 'Помощь и контакты Оргкомитета',
    description:
      'Контакты Оргкомитета конкурса «Лидеры права – 2027», ответы на частые вопросы команд, обращение в Оргкомитет и апелляция по итогам этапа из личного кабинета.',
    path: '/cabinet/help',
  });

  const [data, setData] = useState<CabinetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setSessionLost(false);
    try {
      setData(await fetchCabinetData());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSessionLost(true);
        setData(null);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить данные личного кабинета.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoading label="Открываем раздел «Помощь»…" />
      </main>
    );
  }

  if (sessionLost) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetSessionLost />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoadError message={error ?? 'Не удалось получить данные команды.'} onRetry={() => void load()} />
      </main>
    );
  }

  return <HelpSection data={data} onReload={load} />;
}

function HelpSection({ data, onReload }: { data: CabinetData; onReload: () => Promise<void> }) {
  const { data: season } = useSeason();
  const settings = (season?.settings ?? {}) as Record<string, unknown>;

  const contactEmail = typeof settings['site.contact_email'] === 'string' ? settings['site.contact_email'] : 'lidery.prava@mail.ru';
  const community =
    typeof settings['site.vk_community'] === 'string' ? settings['site.vk_community'] : 'https://vk.com/lideri.prava2026';
  const organizerPhone = '8 (966) 789-76-05';
  const organizerVk = 'https://vk.ru/id274466891';

  return (
    <CabinetLayout
      data={data}
      title="Помощь"
      lead="Контакты Оргкомитета, ответы на частые вопросы команд, обращение и апелляция. Обращение доступно в любой момент, в том числе после окончания приёма материалов."
      onReload={onReload}
    >
      <CabinetSection
        title="Контакты Оргкомитета"
        description="Отвечает Оргкомитет конкурса. Время работы — по московскому времени."
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="mono-label text-muted">Руководитель Оргкомитета</dt>
            <dd className="mt-1">Тажибов Арслан Азизович</dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Телефон</dt>
            <dd className="mt-1">
              <a href={`tel:${organizerPhone.replace(/[^\d+]/g, '')}`} className="text-accent underline underline-offset-2">
                {organizerPhone}
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted">ВКонтакте</dt>
            <dd className="mt-1">
              <a
                href={organizerVk}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline underline-offset-2"
              >
                vk.ru/id274466891
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Электронная почта</dt>
            <dd className="mt-1">
              <a href={`mailto:${contactEmail}`} className="text-accent underline underline-offset-2">
                {contactEmail}
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Сообщество ВКонтакте</dt>
            <dd className="mt-1">
              <a
                href={community}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline underline-offset-2"
              >
                {community.replace(/^https?:\/\//, '')}
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Заявка команды</dt>
            <dd className="mt-1 font-mono">
              {data.team.public_number ?? '—'} · {data.team.name}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted">
          Название команды и статус заявки прикладываются к обращению автоматически, поэтому достаточно описать вопрос.
        </p>
      </CabinetSection>

      <CabinetSection
        title="Частые вопросы"
        description="Короткие ответы на то, с чем команды обращаются чаще всего."
      >
        <ul className="flex flex-col gap-3">
          {FAQ.map((item) => (
            <li key={item.question} className="border border-border">
              <details className="group">
                <summary className="cursor-pointer px-4 py-3 text-body font-medium marker:text-accent">
                  {item.question}
                </summary>
                <p className="max-w-measure px-4 pb-4 text-sm text-muted">{item.answer}</p>
              </details>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          Полный перечень требований — в Положении о конкурсе. Публичные ответы на вопросы — на странице{' '}
          <Link to="/about/faq" className="text-accent underline underline-offset-2">
            «Частые вопросы»
          </Link>
          .
        </p>
      </CabinetSection>

      <CabinetSection
        title="Обращение в Оргкомитет"
        description="Одно обращение — один вопрос: так ответ приходит быстрее."
      >
        <CabinetContactForm
          showTopic
          defaultTopic={data.deadlines.is_application_open ? 'general' : 'deadline'}
          compactNote="Выберите тему «Связь по дедлайну», если срок пропущен или нужна досдача по замечанию."
        />
      </CabinetSection>

      <CabinetSection
        title="Апелляция по итогам этапа"
        description="Подаётся капитаном команды по форме Приложения № 14 в течение двух рабочих дней с момента опубликования протокола этапа (п. 12.1 Положения)."
      >
        <CabinetAppealForm data={data} />
      </CabinetSection>

      <CabinetSection
        title="Кто получит ответ"
        description="Оргкомитет отвечает капитану команды."
      >
        <p className="text-sm text-muted">
          Капитан команды:{' '}
          {data.team.participants.find((participant) => participant.role === 'captain')?.full_name ?? 'не указан'}.
          Обращения и апелляции попадают в карточку команды, поэтому Оргкомитет видит контекст заявки.
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void onReload()}>
            Обновить данные личного кабинета
          </Button>
        </div>
      </CabinetSection>

      {data.team.status === 'disqualified' || data.team.status === 'withdrawn' ? (
        <Alert tone="info" title="Что можно сделать сейчас">
          Участие команды прекращено, поэтому материалы и апелляция недоступны. Оргкомитет остаётся на связи: опишите
          ситуацию в обращении — решение принимает Оргкомитет.
        </Alert>
      ) : null}
    </CabinetLayout>
  );
}
