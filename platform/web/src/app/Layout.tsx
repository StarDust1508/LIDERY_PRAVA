import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatMoscowDate, formatMoscowHuman } from '@shared/index';
import { NAV_SECTIONS, type NavSection } from '@/app/nav';
import { Breadcrumbs, BreadcrumbsProvider } from '@/components/Breadcrumbs';
import { Logo, LogoMark } from '@/components/Logo';
import { useSeason } from '@/lib/season';

// Каркас публичной части: шапка с раскрывающейся навигацией, крошки, подвал.
//
// Требования ТЗ 08, п. 1: подменю раскрываются по клику и по наведению, полная
// работа с клавиатуры (Enter, Esc, стрелки), на узких экранах — полноэкранное
// меню-аккордеон, справа — «Личный кабинет» и кнопка подачи заявки, которая
// заменяется на «Приём заявок завершён» с датой из активного сезона.
//
// Подвал содержит только Ассоциацию выпускников — учредителя конкурса; иные
// организации и прежние контакты не указываются (решение Р9, ТЗ 09, п. 1.5).
// Прежняя почта support@lideryprava.ru не существует и не используется.

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

  // Esc закрывает меню и возвращает фокус на кнопку раздела.
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

  // Стрелки перемещают фокус по пунктам подменю.
  function onButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
    window.setTimeout(() => menuRef.current?.querySelector<HTMLAnchorElement>('a')?.focus(), 0);
  }

  function onItemKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) return;
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1;
    items[(nextIndex + items.length) % items.length]?.focus();
  }

  return (
    <li
      ref={wrapperRef}
      className="relative"
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
        onKeyDown={onButtonKeyDown}
        className={`flex items-center gap-1.5 py-2 text-sm underline-offset-4 hover:text-accent ${
          active ? 'text-accent underline' : ''
        }`}
      >
        {section.title}
        <span aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      <ul
        ref={menuRef}
        onKeyDown={onItemKeyDown}
        className={`absolute left-0 top-full z-50 min-w-[280px] border border-border bg-raised py-2 shadow-[0_18px_40px_-24px_rgba(44,39,34,0.45)] ${
          open ? 'block' : 'hidden'
        }`}
      >
        {section.children.map((child) => (
          <li key={`${child.title}-${child.path}`}>
            {child.external ? (
              <a
                href={child.path}
                target="_blank"
                rel="noreferrer noopener"
                className="block px-4 py-2 text-sm hover:bg-sand hover:text-accent"
                onClick={() => setOpen(false)}
              >
                {child.title}
              </a>
            ) : (
              <NavLink
                to={child.path}
                end={child.path === section.path}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block px-4 py-2 text-sm hover:bg-sand hover:text-accent ${isActive ? 'text-accent' : ''}`
                }
              >
                {child.title}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function MobileSection({ section, onNavigate }: { section: NavSection; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
      >
        <span>{section.title}</span>
        <span aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-1 pb-3 pl-4">
          {section.children.map((child) =>
            child.external ? (
              <li key={child.path}>
                <a href={child.path} target="_blank" rel="noreferrer noopener" className="block py-2 text-muted" onClick={onNavigate}>
                  {child.title}
                </a>
              </li>
            ) : (
              <li key={child.path}>
                <NavLink to={child.path} end={child.path === section.path} className="block py-2" onClick={onNavigate}>
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
  const [compact, setCompact] = useState(false);
  const location = useLocation();
  const { data } = useSeason();

  // Шапка закреплена и «поджимается» при прокрутке, но высота строки остаётся
  // прежней: контент под шапкой не сдвигается (ТЗ 08, п. 1.3.5).
  useEffect(() => {
    function onScroll() {
      setCompact(window.scrollY > 24);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  return (
    <BreadcrumbsProvider>
      <div className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only-text focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-accent focus:bg-raised focus:px-4 focus:py-2"
        >
          Перейти к содержанию
        </a>

        <header className="sticky top-0 z-40 border-b border-border bg-raised/95 backdrop-blur">
          <div className="mx-auto flex max-w-container items-center justify-between gap-4 px-6 py-3">
            <Link to="/" aria-label="Лидеры права – 2027, на главную" className="shrink-0">
              {compact ? <LogoMark size={30} /> : <Logo />}
            </Link>

            <nav aria-label="Основная навигация" className="hidden lg:block">
              <ul className="flex items-center gap-4">
                {NAV_SECTIONS.map((section) => (
                  <DesktopSection
                    key={section.title}
                    section={section}
                    active={location.pathname === section.path || location.pathname.startsWith(`${section.path}/`)}
                  />
                ))}
              </ul>
            </nav>

            <div className="flex items-center gap-3">
              <Link
                to="/cabinet"
                className="mono-label hidden border border-border-strong px-4 py-2 hover:border-accent hover:text-accent sm:inline-flex"
              >
                Личный кабинет
              </Link>
              {applicationOpen ? (
                <Link
                  to="/apply"
                  className="mono-label bg-accent-solid px-4 py-2 text-on-accent hover:bg-accent-solid-hover"
                >
                  Подать заявку
                </Link>
              ) : notStarted && openAt ? (
                // До открытия приёма подпись «завершён» была бы неверной.
                <Link
                  to="/apply"
                  className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
                  title={`Приём заявок откроется ${formatMoscowHuman(openAt)}`}
                >
                  Приём с {formatMoscowDate(openAt)}
                </Link>
              ) : (
                <Link
                  to="/apply"
                  className="mono-label border border-border-strong px-4 py-2 text-muted hover:border-accent hover:text-accent"
                  title="Приём заявок завершён"
                >
                  Приём заявок завершён
                </Link>
              )}
              <button
                type="button"
                className="mono-label border border-border-strong px-3 py-2 lg:hidden"
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
                onClick={() => setMenuOpen((value) => !value)}
              >
                {menuOpen ? 'Закрыть' : 'Меню'}
              </button>
            </div>
          </div>

          {!applicationOpen ? (
            <p className="border-t border-border bg-sand px-6 py-2 text-center text-sm text-muted">
              {notStarted && openAt
                ? `Приём заявок откроется ${formatMoscowHuman(openAt)}`
                : closeAt
                  ? `Приём заявок завершён ${formatMoscowHuman(closeAt)}`
                  : 'Приём заявок закрыт'}
            </p>
          ) : null}
        </header>

        {menuOpen ? (
          <div id="mobile-nav" className="fixed inset-0 top-[64px] z-30 overflow-y-auto bg-bg px-6 pb-10 lg:hidden">
            <nav aria-label="Основная навигация (мобильная)">
              <ul className="flex flex-col">
                {NAV_SECTIONS.map((section) => (
                  <MobileSection key={section.title} section={section} onNavigate={() => setMenuOpen(false)} />
                ))}
              </ul>
            </nav>
            <div className="mt-6 flex flex-col gap-3">
              <Link to="/cabinet" className="mono-label border border-border-strong px-4 py-3 text-center">
                Личный кабинет
              </Link>
              <Link to="/apply" className="mono-label bg-accent-solid px-4 py-3 text-center text-on-accent">
                {applicationOpen
                  ? 'Подать заявку'
                  : notStarted
                    ? 'Приём заявок ещё не открыт'
                    : 'Приём заявок завершён'}
              </Link>
            </div>
          </div>
        ) : null}

        <Breadcrumbs />

        <main id="main" className="flex-1">
          <Outlet />
        </main>

        <footer className="border-t border-border bg-sand">
          <div className="mx-auto grid max-w-container gap-8 px-6 py-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <Logo />
              <p className="mono-label mt-6">Учредитель конкурса</p>
              <p className="mt-3 max-w-measure text-sm">
                Межрегиональная общественная организация выпускников Саратовской государственной юридической академии
                «Ассоциация выпускников СЮИ – СГАП – СГЮА»
              </p>
              <p className="mt-2 text-sm text-muted">
                ОГРН 1087799025522 · ИНН 7701360798
                <br />
                107078, г. Москва, ул. Мясницкая, д. 48
              </p>
            </div>
            <div>
              <p className="mono-label">Разделы</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {NAV_SECTIONS.slice(0, 6).map((section) => (
                  <li key={section.title}>
                    <Link to={section.path} className="underline underline-offset-2 hover:text-accent">
                      {section.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mono-label">Контакты</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                <li>
                  <a href="mailto:ssla_av@mail.ru" className="underline underline-offset-2 hover:text-accent">
                    ssla_av@mail.ru
                  </a>
                </li>
                <li>
                  <a href="tel:+79060747313" className="underline underline-offset-2 hover:text-accent">
                    +7 (906) 074-73-13
                  </a>
                </li>
                <li>
                  <a href="https://vk.com/lideri.prava2026" className="underline underline-offset-2 hover:text-accent">
                    Сообщество во «ВКонтакте»
                  </a>
                </li>
                <li>
                  <Link to="/cabinet/access" className="underline underline-offset-2 hover:text-accent">
                    Вход в личный кабинет
                  </Link>
                </li>
                <li>
                  <Link to="/legal/offer" className="underline underline-offset-2 hover:text-accent">
                    Оферта и правовая информация
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border">
            <p className="mx-auto max-w-container px-6 py-4 text-sm text-muted">
              Сезон 2026/2027 · Десятый ежегодный федеральный научно-образовательный конкурс «Лидеры права – 2027»
            </p>
          </div>
        </footer>
      </div>
    </BreadcrumbsProvider>
  );
}
