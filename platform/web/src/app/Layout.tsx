import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatMoscowHuman } from '@shared/index';
import { NAV_SECTIONS, type NavSection } from '@/app/nav';
import { Breadcrumbs, BreadcrumbsProvider } from '@/components/Breadcrumbs';
import { useSeason } from '@/lib/season';

// Каркас публичной части.
//
// Разметка и классы — прежнего сайта конкурса (.nav, .nav-inner, .nav-mark,
// .nav-links, .nav-cta и .foot с сеткой .foot-top). Стили лежат в src/site/site.css
// и ограничены областью .site, поэтому служебные экраны платформы (мастер подачи,
// личный кабинет, админка) не затрагиваются.
//
// Отличия от прежней вёрстки — только там, где это требует ТЗ:
//   • подменю разделов (ТЗ 08, п. 1.1) — прежняя навигация была плоской;
//   • в подписи знака нет декоративного года «©2026» (запрещён ТЗ 08, п. 1.3.3):
//     сезон указывается словами «Сезон 2026/2027»;
//   • контакты подвала — действующие: почта Ассоциации, телефон и сообщество
//     во «ВКонтакте» (ТЗ 02, п. 11; почта support@lideryprava.ru не существует);
//   • кнопка подачи заявки отражает состояние приёма из активного сезона.

const HOVER_DELAY_MS = 120;

function DesktopSection({ section, active }: { section: NavSection; active: boolean }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLLIElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const openWithDelay = useCallback(() => {
    cancelTimer();
    timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  }, [cancelTimer]);

  const closeWithDelay = useCallback(() => {
    cancelTimer();
    timer.current = window.setTimeout(() => setOpen(false), HOVER_DELAY_MS);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      wrapperRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <li
      ref={wrapperRef}
      className="nav-item"
      onMouseEnter={openWithDelay}
      onMouseLeave={closeWithDelay}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setOpen(true);
          window.setTimeout(() => menuRef.current?.querySelector<HTMLAnchorElement>('a')?.focus(), 0);
        }}
        className={active ? 'is-active' : undefined}
      >
        {section.title}
      </button>

      <ul ref={menuRef} className={`nav-sub${open ? ' is-open' : ''}`}>
        {section.children.map((child) =>
          child.external ? (
            <li key={child.path}>
              <a href={child.path} target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}>
                {child.title}
              </a>
            </li>
          ) : (
            <li key={child.path}>
              <NavLink to={child.path} end={child.path === section.path} onClick={() => setOpen(false)}>
                {child.title}
              </NavLink>
            </li>
          )
        )}
      </ul>
    </li>
  );
}

function MobileSection({ section, onNavigate }: { section: NavSection; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="nav-mobile-item">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{section.title}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <ul className="nav-mobile-sub">
          {section.children.map((child) =>
            child.external ? (
              <li key={child.path}>
                <a href={child.path} target="_blank" rel="noreferrer noopener" onClick={onNavigate}>
                  {child.title}
                </a>
              </li>
            ) : (
              <li key={child.path}>
                <NavLink to={child.path} end={child.path === section.path} onClick={onNavigate}>
                  {child.title}
                </NavLink>
              </li>
            )
          )}
        </ul>
      ) : null}
    </li>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { data } = useSeason();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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

  const applyLabel = applicationOpen ? 'Подать заявку' : notStarted ? 'Приём с открытия' : 'Приём завершён';

  return (
    <BreadcrumbsProvider>
      <div className="site">
        <a href="#main" className="sr-only-text no-print">
          Перейти к содержанию
        </a>

        {/* Шапка прежнего сайта: полоса 64 px, знак, ссылки разделов, действие. */}
        <nav className="nav" aria-label="Основная навигация">
          <div className="wrap nav-inner">
            <Link to="/" className="nav-mark" aria-label="Лидеры Права, на главную">
              <img src="/assets/logo.jpg" alt="Эмблема конкурса «Лидеры Права»" width={30} height={30} />
              Лидеры&nbsp;Права <sup>Сезон 2026/2027</sup>
            </Link>

            <div className="nav-links" id="navLinks">
              <ul>
                {NAV_SECTIONS.map((section) => (
                  <DesktopSection
                    key={section.title}
                    section={section}
                    active={location.pathname === section.path || location.pathname.startsWith(`${section.path}/`)}
                  />
                ))}
              </ul>
              <Link to="/cabinet" className="nav-cta mono">
                Личный кабинет
              </Link>
              <Link to="/apply" className="nav-cta mono">
                {applyLabel} →
              </Link>
            </div>

            <button
              type="button"
              className="nav-burger"
              aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={menuOpen}
              aria-controls="navLinks"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          {!applicationOpen ? (
            <div className="nav-note mono">
              {notStarted && openAt
                ? `Приём заявок откроется ${formatMoscowHuman(openAt)}`
                : closeAt
                  ? `Приём заявок завершён ${formatMoscowHuman(closeAt)}`
                  : 'Приём заявок закрыт'}
            </div>
          ) : null}
        </nav>

        {menuOpen ? (
          <div className="site-mobile-menu">
            <ul className="nav-mobile">
              {NAV_SECTIONS.map((section) => (
                <MobileSection key={section.title} section={section} onNavigate={() => setMenuOpen(false)} />
              ))}
            </ul>
            <div className="site-mobile-actions">
              <Link to="/cabinet" className="nav-cta mono" onClick={() => setMenuOpen(false)}>
                Личный кабинет
              </Link>
              <Link to="/apply" className="nav-cta mono" onClick={() => setMenuOpen(false)}>
                {applyLabel} →
              </Link>
            </div>
          </div>
        ) : null}

        <div className="site-body">
          <Breadcrumbs />
          <main id="main">
            <Outlet />
          </main>

          {/* Подвал прежнего сайта: сетка 1.4fr 1fr 1fr и нижняя полоса. */}
          <footer className="foot">
            <div className="wrap">
              <div className="foot-top">
                <div className="foot-brand">
                  <Link to="/" className="fb-mark">
                    <img src="/assets/logo.jpg" alt="Эмблема конкурса «Лидеры Права»" width={36} height={36} />
                    Лидеры&nbsp;Права
                  </Link>
                  <p>
                    Десятый ежегодный федеральный научно-образовательный конкурс для студентов и молодых специалистов:
                    наставники, экспертиза, финал в Москве, стажировки и публикация законотворческих инициатив.
                  </p>
                </div>

                <div className="foot-col">
                  <h4 className="mono">Навигация</h4>
                  <Link to="/about">О конкурсе</Link>
                  <Link to="/about/history">История конкурса</Link>
                  <Link to="/stages">Этапы и календарь</Link>
                  <Link to="/participants">Участникам</Link>
                  <Link to="/initiatives">Архив законопроектов</Link>
                  <Link to="/winners">Победители</Link>
                  <Link to="/documents">Документы</Link>
                </div>

                <div className="foot-col">
                  <h4 className="mono">Контакты</h4>
                  <a href="mailto:ssla_av@mail.ru">ssla_av@mail.ru</a>
                  <a href="tel:+79060747313">+7 (906) 074-73-13</a>
                  <a href="https://vk.com/lideri.prava2026" target="_blank" rel="noopener noreferrer">
                    Сообщество во «ВКонтакте»
                  </a>
                  <Link to="/contacts">Форма обращения</Link>
                  <Link to="/cabinet/access">Вход в личный кабинет</Link>
                </div>
              </div>

              <div className="foot-bottom">
                <div className="fb-copy">
                  <span className="mono">Сезон 2026/2027 · конкурс «Лидеры права – 2027»</span>
                </div>
                <div className="foot-legal">
                  <Link to="/legal/offer">Оферта</Link>
                  <Link to="/legal/privacy">Политика обработки персональных данных</Link>
                  <Link to="/legal/terms">Пользовательское соглашение</Link>
                </div>
              </div>

              <div className="foot-req mono">
                Учредитель: Межрегиональная общественная организация выпускников Саратовской государственной
                юридической академии «Ассоциация выпускников СЮИ – СГАП – СГЮА» · ОГРН 1087799025522 · ИНН 7701360798 ·
                107078, г. Москва, ул. Мясницкая, д. 48
              </div>
            </div>
          </footer>
        </div>
      </div>
    </BreadcrumbsProvider>
  );
}
