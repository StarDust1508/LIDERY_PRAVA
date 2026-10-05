import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type SeasonResponse, api } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Контакты Оргкомитета (п. 17 Положения). Почта support@lideryprava.ru не
// существует и не используется: указана действующая почта Ассоциации.

export function ContactsPage() {
  const [season, setSeason] = useState<SeasonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useSeo({
    title: 'Контакты Оргкомитета',
    description:
      'Контакты Оргкомитета конкурса «Лидеры права – 2027»: руководитель Оргкомитета, электронная почта и сообщество во «ВКонтакте».',
    path: '/contacts',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Контакты', path: '/contacts' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.season();
        if (active) setSeason(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить контакты.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const settings = (season?.settings ?? {}) as Record<string, unknown>;
  const email = typeof settings['site.contact_email'] === 'string' ? settings['site.contact_email'] : 'ssla_av@mail.ru';
  const phone = typeof settings['site.contact_phone'] === 'string' ? settings['site.contact_phone'] : '+7 (906) 074-73-13';
  const vk = typeof settings['site.vk_community'] === 'string' ? settings['site.vk_community'] : 'https://vk.com/lideri.prava2026';

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Связь</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Контакты</h1>
      </header>

      {error ? <Alert tone="warning">{error}</Alert> : null}

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
              <a href={`mailto:${email}`} className="text-accent underline underline-offset-2">
                {email}
              </a>
            </dd>
            <dt className="mono-label mt-4 text-muted">Телефон Ассоциации</dt>
            <dd className="mt-1">
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="text-accent underline underline-offset-2">
                {phone}
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

      <SectionCard title="Связь через сайт" description="Если дедлайн прошёл, эти способы остаются доступными.">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            Форма обращения в личном кабинете:{' '}
            <Link to="/cabinet" className="text-accent underline underline-offset-2">
              раздел «Связаться с Оргкомитетом»
            </Link>
            . Обращение фиксируется в системе и не теряется.
          </li>
          <li>
            Отзыв согласия на обработку персональных данных:{' '}
            <a href={`mailto:${email}`} className="text-accent underline underline-offset-2">
              письменное заявление на {email}
            </a>
            . Отзыв до завершения конкурса прекращает участие.
          </li>
        </ul>
      </SectionCard>
    </main>
  );
}
