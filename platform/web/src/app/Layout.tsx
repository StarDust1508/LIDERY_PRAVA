import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

// Каркас публичной части: шапка с навигацией и подвал.
//
// Подвал содержит только Ассоциацию выпускников — учредителя конкурса; иные
// организации и прежние контакты не указываются (решение Р9, ТЗ 09, п. 1.5).
// Прежняя почта support@lideryprava.ru не существует и не используется.

const NAV_ITEMS = [
  { path: '/about', title: 'О конкурсе' },
  { path: '/stages', title: 'Этапы' },
  { path: '/participants', title: 'Участникам' },
  { path: '/masterclasses', title: 'Мастер-классы' },
  { path: '/initiatives', title: 'Архив законопроектов' },
  { path: '/winners', title: 'Победители' },
  { path: '/documents', title: 'Документы' },
  { path: '/contacts', title: 'Контакты' },
];

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only-text focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-accent focus:bg-raised focus:px-4 focus:py-2"
      >
        Перейти к содержанию
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-raised">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="flex items-center gap-3" aria-label="Лидеры права – 2027, на главную">
            <img src="/assets/logo.jpg" alt="" width={36} height={36} className="h-9 w-9 object-contain" />
            <span className="mono-label">Лидеры права&nbsp;– 2027</span>
          </Link>

          <button
            type="button"
            className="mono-label border border-border-strong px-3 py-2 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? 'Закрыть' : 'Меню'}
          </button>

          <nav
            id="main-nav"
            aria-label="Основная навигация"
            className={`${menuOpen ? 'block' : 'hidden'} w-full md:block md:w-auto`}
          >
            <ul className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-4">
              {NAV_ITEMS.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `text-sm underline-offset-4 hover:text-accent ${isActive ? 'text-accent underline' : ''}`
                    }
                    aria-current={location.pathname === item.path ? 'page' : undefined}
                  >
                    {item.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <Link to="/cabinet" className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent">
              Личный кабинет
            </Link>
            <Link to="/apply" className="mono-label bg-accent-solid px-4 py-2 text-on-accent hover:bg-accent-solid-hover">
              Подать заявку
            </Link>
          </div>
        </div>
      </header>

      <div id="main" className="flex-1">
        <Outlet />
      </div>

      <footer className="border-t border-border bg-sand">
        <div className="mx-auto grid max-w-container gap-8 px-6 py-10 md:grid-cols-3">
          <div>
            <p className="mono-label">Учредитель конкурса</p>
            <p className="mt-3 text-sm">
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
              <li>
                <Link to="/documents" className="underline underline-offset-2 hover:text-accent">
                  Документы конкурса
                </Link>
              </li>
              <li>
                <Link to="/initiatives" className="underline underline-offset-2 hover:text-accent">
                  Архив законопроектов
                </Link>
              </li>
              <li>
                <Link to="/contacts" className="underline underline-offset-2 hover:text-accent">
                  Контакты Оргкомитета
                </Link>
              </li>
              <li>
                <Link to="/cabinet/access" className="underline underline-offset-2 hover:text-accent">
                  Вход в личный кабинет
                </Link>
              </li>
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
  );
}
