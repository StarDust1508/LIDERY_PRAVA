import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type PublicPage, type PublicPartner, api } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Партнёры конкурса (ТЗ 08, п. 2.1; ТЗ 02, п. 1 и 10).
//
// Учредитель и генеральный партнёр названы Положением — они показаны текстом и
// не зависят от наполнения базы. Остальные партнёры приходят из `partners`
// вместе с логотипами и ссылками. Пока список пуст, страница объясняет, почему
// он пополняется, и не оставляет пустых мест.

/** Подписи видов партнёрства: значения поля `partner_type`. */
const PARTNER_TYPE_TITLES: Record<string, string> = {
  general: 'Генеральный партнёр',
  partner: 'Партнёр',
  sponsor: 'Спонсор',
  info: 'Информационный партнёр',
  expert: 'Экспертный партнёр',
};

/** Логотипы партнёров, подготовленные как статические файлы (23.10.2026). */
const PARTNER_LOGOS: ReadonlyArray<{ match: RegExp; src: string; alt: string }> = [
  { match: /АСПБ|Агентство сопровождения процедур банкротства/i, src: '/assets/partners/aspb.png', alt: 'Логотип АСПБ' },
];

function partnerLogoSrc(name: string): string | null {
  return PARTNER_LOGOS.find((item) => item.match.test(name))?.src ?? null;
}

export function PartnersPage() {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [partners, setPartners] = useState<PublicPartner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: page?.seo_title ?? 'Партнёры конкурса',
    description:
      page?.seo_description ??
      'Учредитель и партнёры конкурса «Лидеры\u00A0права\u00A0– 2027»: Ассоциация выпускников СЮИ – СГАП – СГЮА, «Ассоциация юристов России» и организации, поддерживающие конкурс.',
    path: '/about/partners',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'О конкурсе', path: '/about' },
      { name: 'Партнёры конкурса', path: '/about/partners' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.page('about-partners');
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
        const data = await api.partners();
        if (active) setPartners(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить список партнёров.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Генеральный партнёр назван Положением и показан отдельным блоком, поэтому в
  // списке из базы он не повторяется.
  const otherPartners = partners.filter((partner) => partner.partner_type !== 'general');

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="О конкурсе"
        title={page?.title ?? 'Партнёры конкурса'}
        lead="Организации, которые поддерживают конкурс: учредитель, генеральный партнёр и партнёры отдельных направлений и номинаций."
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

      <Section title="Учредитель" description="Оператор персональных данных конкурса.">
        <Prose>
          <p>
            Межрегиональная общественная организация выпускников Саратовской государственной юридической академии
            «Ассоциация выпускников СЮИ – СГАП – СГЮА». ОГРН 1087799025522, ИНН 7701360798. Юридический адрес:
            107078, г. Москва, ул. Мясницкая, д. 48.
          </p>
          <p className="text-sm text-muted">
            Вопросы об участии и о партнёрстве —{' '}
            <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
              lidery.prava@mail.ru
            </a>
            . Контакты Оргкомитета — в разделе{' '}
            <Link to="/contacts" className="text-accent underline underline-offset-2">
              «Контакты»
            </Link>
            .
          </p>
        </Prose>
      </Section>

      <Section title="Генеральный партнёр" description="Организация, поддерживающая конкурс по Положению.">
        <Prose>
          <p>Общероссийская общественная организация «Ассоциация юристов России».</p>
        </Prose>
      </Section>

      <Section
        title="Партнёры и спонсоры"
        description="Организации, поддерживающие конкурс. Логотипы публикуются при наличии согласия."
      >
        {loading ? (
          <p role="status">Загружаем список партнёров…</p>
        ) : error ? (
          <Alert tone="warning" title="Список партнёров недоступен">
            {error} Генеральный партнёр и учредитель указаны выше; список остальных организаций открывается после
            восстановления связи с сервером.
          </Alert>
        ) : otherPartners.length === 0 ? (
          <p className="max-w-measure text-sm text-muted">
            Список пополняется: Оргкомитет публикует организации по мере подтверждения участия и согласия на
            размещение логотипов. Генеральный партнёр и учредитель указаны выше. Предложения о партнёрстве —{' '}
            <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
              lidery.prava@mail.ru
            </a>
            .
          </p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {otherPartners.map((partner) => (
              <li key={partner.id} className="flex flex-col gap-3 border border-border p-5">
                <p className="mono-label text-muted">{PARTNER_TYPE_TITLES[partner.partner_type] ?? 'Партнёр'}</p>
                {partner.logo_url || partnerLogoSrc(partner.name) ? (
              <img
                src={partner.logo_url ?? partnerLogoSrc(partner.name) ?? ''}
                alt={`Логотип: ${partner.name}`}
                className="h-16 w-auto object-contain"
                loading="lazy"
              />
            ) : null}
                <p className="font-medium">{partner.name}</p>
                {partner.description ? <p className="text-sm text-muted">{partner.description}</p> : null}
                {partner.url ? (
                  <a
                    href={partner.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Сайт партнёра: ${partner.name}`}
                    className="text-sm text-accent underline underline-offset-2"
                  >
                    Сайт партнёра
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-sm text-muted">
        Правовая основа участия —{' '}
        <Link to="/about/regulations" className="text-accent underline underline-offset-2">
          Положение о конкурсе
        </Link>
        ; полный список документов — в разделе{' '}
        <Link to="/documents" className="text-accent underline underline-offset-2">
          «Документы»
        </Link>
        .
      </p>
    </main>
  );
}
