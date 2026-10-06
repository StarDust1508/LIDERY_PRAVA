import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatMoscowHuman } from '@shared/index';
import { FOOTER_GROUPS } from '@/app/nav';
import { Breadcrumbs, BreadcrumbsProvider } from '@/components/Breadcrumbs';
import { ArrowUpRight, External, Mail, Phone } from '@/components/Icon';
import { PageNav, ToTopButton } from '@/components/PageNav';
import { SiteMenu } from '@/components/SiteMenu';
import { useReveal } from '@/lib/reveal';
import { useSeason } from '@/lib/season';

// Каркас публичной части.
//
// Компоновка прежнего сайта (классы .site, .nav, .foot) сохранена, но шапка
// переработана: сверху — только знак, четыре ключевых раздела и два действия,
// вся структура уезжает в шторку (components/SiteMenu.tsx). Подвал стал картой
// сайта: каждый раздел и каждая страница.
//
// Отличия от прежней вёрстки — только там, где этого требует ТЗ:
//   • в подписи знака нет декоративного года «©2026» (запрещён ТЗ 08, п. 1.3.3);
//   • контакты подвала — действующие: почта Ассоциации, телефон и сообщество
//     во «ВКонтакте» (ТЗ 02, п. 11; почта support@lideryprava.ru не существует);
//   • кнопка подачи заявки отражает состояние приёма из активного сезона.

/** Ключевые разделы, которые остаются в верхней полосе. */
const TOP_LINKS: readonly { title: string; path: string }[] = [
  { title: 'О конкурсе', path: '/about' },
  { title: 'Этапы', path: '/stages' },
  { title: 'Участнику', path: '/participants' },
  { title: 'Победители', path: '/winners' },
];

/** Короткая дата для подписи кнопки: «11 декабря». */
function shortDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();
  const { data } = useSeason();

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Появление блоков при прокрутке (см. lib/reveal.ts).
  useReveal();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const season = data?.season ?? null;
  const applicationOpen = season ? season.is_application_open : true;
  const notStarted = season?.application_not_started === true;
  const closeAt = season?.application_close_at ?? null;
  const openAt = season?.application_open_at ?? null;

  const applyLabel = applicationOpen ? 'Подать заявку' : notStarted ? 'Приём заявок закрыт' : 'Приём завершён';
  const openDay = shortDate(openAt);

  return (
    <BreadcrumbsProvider>
      <div className="site">
        {/* Ссылка «к содержанию»: видна только при переходе с клавиатуры. */}
        <a
          href="#main"
          className="no-print sr-only-text focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-accent focus:bg-raised focus:px-4 focus:py-2"
        >
          Перейти к содержанию
        </a>

        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link to="/" className="topbar-mark" aria-label="Лидеры права, на главную">
              <img src="/assets/logo.jpg" alt="" width={32} height={32} />
              <span className="topbar-word">Лидеры&nbsp;права</span>
            </Link>

            <nav className="topbar-links" aria-label="Ключевые разделы">
              {TOP_LINKS.map((link) => (
                <NavLink
                  key={link.path}
                  to={link.path}
                  className={({ isActive }) => (isActive ? 'is-active' : undefined)}
                >
                  {link.title}
                </NavLink>
              ))}
            </nav>

            <div className="topbar-actions">
              <Link to="/cabinet" className="topbar-cabinet">
                Личный кабинет
              </Link>
              <Link to="/apply" className={`topbar-apply${applicationOpen ? '' : ' is-idle'}`}>
                <span>
                  {applyLabel}
                  {!applicationOpen && openDay ? <small>с {openDay}</small> : null}
                </span>
                <ArrowUpRight size={18} />
              </Link>
              <button
                ref={burgerRef}
                type="button"
                className={`burger${menuOpen ? ' is-open' : ''}`}
                aria-expanded={menuOpen}
                aria-controls="site-menu"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <span className="burger-icon" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span className="burger-label">{menuOpen ? 'Закрыть' : 'Все разделы'}</span>
              </button>
            </div>
          </div>

          {!applicationOpen ? (
            <p className="topbar-note">
              {notStarted && openAt
                ? `Приём заявок откроется ${formatMoscowHuman(openAt)}`
                : closeAt
                  ? `Приём заявок завершён ${formatMoscowHuman(closeAt)}`
                  : 'Приём заявок закрыт'}
            </p>
          ) : null}
        </header>

        <SiteMenu open={menuOpen} onClose={closeMenu} applyLabel={applyLabel} returnFocusTo={burgerRef.current} />

        <div className="site-body">
          <Breadcrumbs />

          <main id="main">
            <Outlet />
            <PageNav />
          </main>

          {/* Подвал-карта сайта: каждый раздел и каждая страница. */}
          <footer className="foot">
            <div className="wrap">
              <div className="foot-top">
                <div className="foot-brand">
                  <Link to="/" className="fb-mark">
                    <img src="/assets/logo.jpg" alt="" width={36} height={36} />
                    Лидеры&nbsp;права
                  </Link>
                  <p>
                    Десятый ежегодный федеральный научно-образовательный конкурс для студентов и молодых
                    специалистов: наставники, экспертиза, финал в Москве, стажировки и публикация
                    законотворческих инициатив.
                  </p>
                  <div className="fb-contacts">
                    <a href="mailto:ssla_av@mail.ru">
                      <Mail size={16} />
                      ssla_av@mail.ru
                    </a>
                    <a href="tel:+79060747313">
                      <Phone size={16} />
                      +7 (906) 074-73-13
                    </a>
                    <a href="https://vk.com/lideri.prava2026" target="_blank" rel="noopener noreferrer">
                      Сообщество во «ВКонтакте»
                      <External size={14} />
                    </a>
                  </div>
                </div>

                {FOOTER_GROUPS.map((group) => (
                  <div className="foot-col" key={group.title}>
                    <h2 className="mono">{group.title}</h2>
                    {group.links.map((link) =>
                      link.external ? (
                        <a key={link.path} href={link.path} target="_blank" rel="noreferrer noopener">
                          {link.title}
                        </a>
                      ) : (
                        <Link key={link.path} to={link.path}>
                          {link.title}
                        </Link>
                      )
                    )}
                  </div>
                ))}
              </div>

              <div className="foot-bottom">
                <p className="fb-copy mono">
                  Конкурс «Лидеры права – 2027» · Сезон 2026/2027 · Учредитель — Ассоциация выпускников
                  СЮИ – СГАП – СГЮА
                </p>
                <div className="foot-legal">
                  <Link to="/legal/offer">Оферта</Link>
                  <Link to="/legal/privacy">Политика обработки персональных данных</Link>
                  <Link to="/legal/terms">Пользовательское соглашение</Link>
                  <Link to="/contacts">Связаться с оргкомитетом</Link>
                </div>
              </div>

              <p className="foot-req mono">
                Учредитель: Межрегиональная общественная организация выпускников Саратовской государственной
                юридической академии «Ассоциация выпускников СЮИ – СГАП – СГЮА» · ОГРН 1087799025522 · ИНН
                7701360798 · 107078, г. Москва, ул. Мясницкая, д. 48
              </p>
            </div>
          </footer>
        </div>

        <ToTopButton />
      </div>
    </BreadcrumbsProvider>
  );
}
