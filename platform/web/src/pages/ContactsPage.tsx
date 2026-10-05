import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '@shared/index';
import { Alert, Button, SectionCard, TextAreaField, TextField } from '@shared/index';
import { PageHeader, Prose } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';

// Контакты Оргкомитета (п. 17 Положения) и форма обращения.
//
// Почта support@lideryprava.ru не существует и не используется: указана
// действующая почта Ассоциации. Обращение с формы попадает в таблицу leads —
// то же хранилище, что и обращения из личного кабинета, поэтому вопрос не
// теряется, даже если письмо не доставлено.

const TOPICS = [
  { value: 'general', title: 'Общий вопрос о конкурсе' },
  { value: 'application', title: 'Вопрос по заявке или материалам' },
  { value: 'access', title: 'Доступ в личный кабинет' },
  { value: 'deadline', title: 'Дедлайн пропущен' },
  { value: 'partnership', title: 'Сотрудничество и партнёрство' },
];

export function ContactsPage() {
  const { data } = useSeason();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [topic, setTopic] = useState('general');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const contactEmail =
    typeof settings['site.contact_email'] === 'string' ? settings['site.contact_email'] : 'ssla_av@mail.ru';
  const contactPhone =
    typeof settings['site.contact_phone'] === 'string' ? settings['site.contact_phone'] : '+7 (906) 074-73-13';
  const vk = typeof settings['site.vk_community'] === 'string' ? settings['site.vk_community'] : 'https://vk.com/lideri.prava2026';

  useSeo({
    title: 'Контакты Оргкомитета',
    description:
      'Контакты Оргкомитета конкурса «Лидеры права – 2027»: руководитель Оргкомитета, электронная почта, сообщество во «ВКонтакте» и форма обращения.',
    path: '/contacts',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Контакты', path: '/contacts' },
    ]),
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (name.trim() === '' || email.trim() === '' || message.trim() === '') {
      setError('Заполните имя, электронную почту и текст обращения.');
      return;
    }
    if (!consent) {
      setError('Для обработки обращения нужно согласие на обработку персональных данных.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.createLead({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        topic: TOPICS.find((item) => item.value === topic)?.title ?? topic,
        message: message.trim(),
        source: 'contacts',
        consent_pdn: true,
        website: trap,
      });
      setNotice(
        `Обращение № ${result.id} принято. Ответ придёт на указанную электронную почту; при необходимости Оргкомитет свяжется по телефону.`
      );
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
      setConsent(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось отправить обращение. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Связь"
        title="Контакты"
        lead="Оргкомитет отвечает по вопросам участия, материалов, доступа в личный кабинет и сроков этапов."
      />

      <SectionCard title="Оргкомитет конкурса" description="Разъяснения по вопросам проведения конкурса.">
        <dl className="grid gap-6 text-sm md:grid-cols-2">
          <div>
            <dt className="mono-label text-muted">Руководитель Оргкомитета</dt>
            <dd className="mt-1">
              Тажибов Арслан Азизович
              <br />
              <a href="tel:+79667897605" className="text-accent underline underline-offset-2">
                8 (966) 789-76-05
              </a>
              <br />
              <a
                href="https://vk.ru/id274466891"
                className="text-accent underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Страница во «ВКонтакте»
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
            <dt className="mono-label mt-4 text-muted">Телефон Ассоциации</dt>
            <dd className="mt-1">
              <a href={`tel:${contactPhone.replace(/[^\d+]/g, '')}`} className="text-accent underline underline-offset-2">
                {contactPhone}
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Сообщество конкурса</dt>
            <dd className="mt-1">
              <a href={vk} className="text-accent underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                {vk}
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted">Учредитель</dt>
            <dd className="mt-1">
              Ассоциация выпускников СЮИ – СГАП – СГЮА
              <br />
              107078, г. Москва, ул. Мясницкая, д. 48
              <br />
              Корреспонденция: 125124, г. Москва, 3-я ул. Ямского поля, д. 2, стр. 13
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title="Написать в Оргкомитет"
        description="Обращение попадает в систему конкурса: его видит Оргкомитет и оно не теряется при сбое почты."
      >
        {notice ? <Alert tone="success" title="Обращение принято">{notice}</Alert> : null}
        {error ? <Alert tone="danger" title="Обращение не отправлено">{error}</Alert> : null}

        <form className="mt-4 grid gap-5 md:grid-cols-2" onSubmit={submit} noValidate>
          <TextField
            id="lead-name"
            label="Имя и фамилия"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
          <TextField
            id="lead-email"
            label="Электронная почта"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            hint="На этот адрес придёт ответ."
          />
          <TextField
            id="lead-phone"
            label="Телефон"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            hint="Необязательно."
          />
          <div className="flex flex-col gap-2">
            <label htmlFor="lead-topic" className="mono-label">
              Тема обращения
            </label>
            <select
              id="lead-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="min-h-[44px] border border-border-strong bg-raised px-3"
            >
              {TOPICS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <TextAreaField
              id="lead-message"
              label="Текст обращения"
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              hint="Опишите ситуацию и укажите название команды и номер заявки, если они есть."
            />
          </div>

          <div className="flex items-start gap-3 md:col-span-2">
            <input
              id="lead-consent"
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 h-5 w-5"
            />
            <label htmlFor="lead-consent" className="max-w-measure text-sm">
              Согласен на обработку персональных данных для ответа на обращение. Согласие можно отозвать письмом на{' '}
              {contactEmail}.
            </label>
          </div>

          {/* Ловушка для автоматических отправителей: человек это поле не видит. */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="lead-website">Сайт</label>
            <input
              id="lead-website"
              type="text"
              tabIndex={-1}
              value={trap}
              onChange={(event) => setTrap(event.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <Button type="submit" loading={busy}>
              Отправить обращение
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Связь через личный кабинет" description="Если срок подачи материалов уже истёк, эти способы остаются доступными.">
        <Prose>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>
              Обращение из личного кабинета:{' '}
              <Link to="/cabinet" className="text-accent underline underline-offset-2">
                раздел «Помощь»
              </Link>
              . К обращению автоматически прикладываются название команды и статус заявки.
            </li>
            <li>
              Отзыв согласия на обработку персональных данных — письменное заявление на{' '}
              <a href={`mailto:${contactEmail}`} className="text-accent underline underline-offset-2">
                {contactEmail}
              </a>
              . Отзыв до завершения конкурса прекращает участие.
            </li>
            <li>
              Персональные данные обрабатываются в соответствии с{' '}
              <Link to="/legal/privacy" className="text-accent underline underline-offset-2">
                политикой обработки персональных данных
              </Link>
              .
            </li>
          </ul>
        </Prose>
      </SectionCard>
    </main>
  );
}
