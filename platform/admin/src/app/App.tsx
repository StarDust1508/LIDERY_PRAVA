import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  adminApi,
  getAdminToken,
  setAdminToken,
  type AdminSessionInfo,
  type AdminStats,
  type AdminUserRole,
} from '@shared/index';
import { ApplicationPage } from '../pages/ApplicationPage';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import { AppealsPage } from '../pages/AppealsPage';
import { AuditPage } from '../pages/AuditPage';
import { DashboardPage } from '../pages/DashboardPage';
import { EvaluationPage } from '../pages/EvaluationPage';
import { LeadsPage } from '../pages/LeadsPage';
import { LoginPage } from '../pages/LoginPage';
import { MaterialsPage } from '../pages/MaterialsPage';
import { RankingsPage } from '../pages/RankingsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TeamsPage } from '../pages/TeamsPage';
import { UsersPage } from '../pages/UsersPage';
import { ResourceScreen } from '../components/ResourceScreen';
import { RESOURCES } from '../lib/resources';

// Админ-панель — отдельная сборка (ТЗ 03, 07). Доступ закрыт сессией: без
// проверки токена не отображается ни один раздел и не запрашиваются данные.
//
// Разделы (ТЗ 07, п. 2): сводка, заявки, материалы, команды, оценки, рейтинг,
// апелляции, обращения, мастер-классы, новости, документы, победители,
// страницы, архив законопроектов, эксперты, критерии, сезоны, направления,
// настройки, пользователи и журнал действий.
//
// Роли (п. 1.3): оператор ведёт заявки, материалы, обращения, мастер-классы,
// новости и документы. Разделы, меняющие правила конкурса и права доступа
// (пользователи, настройки, справочники, эксперты, публикация протокола,
// выгрузка персональных данных), доступны только администратору. Каждый такой
// раздел всё равно закрыт на сервере: интерфейс лишь не показывает то, что
// вернёт 403.
//
// Бездействие (п. 1.2): сервер завершает сеанс после 60 минут без обращений.
// Интерфейс следит за этим сам: предупреждает за 5 минут и отправляет отметку
// активности, пока пользователь работает.

type AuthState = 'checking' | 'authenticated' | 'anonymous';

const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

interface NavItem {
  to: string;
  title: string;
  adminOnly?: boolean;
  /** Ключ счётчика внимания: число выводится рядом с пунктом меню (п. 1.7). */
  counter?: keyof AdminStats['attention'];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: 'Работа с заявками',
    items: [
      { to: '/', title: 'Сводка' },
      { to: '/applications', title: 'Заявки', counter: 'applications_pending' },
      { to: '/materials', title: 'Материалы', counter: 'materials_needs_fix' },
      { to: '/teams', title: 'Команды' },
      { to: '/evaluation', title: 'Оценки' },
      { to: '/rankings', title: 'Рейтинг' },
      { to: '/appeals', title: 'Апелляции', counter: 'appeals_open' },
      { to: '/leads', title: 'Обращения', counter: 'leads_new' },
      { to: '/legacy-applications', title: 'Заявки 2026 (архив)', adminOnly: true },
    ],
  },
  {
    title: 'Контент сайта',
    items: [
      { to: '/masterclasses', title: 'Мастер-классы' },
      { to: '/news', title: 'Новости' },
      { to: '/documents', title: 'Документы' },
      { to: '/winners', title: 'Победители' },
      { to: '/initiatives', title: 'Архив законопроектов' },
      { to: '/pages', title: 'Страницы сайта', adminOnly: true },
      { to: '/partners', title: 'Партнёры' },
    ],
  },
  {
    title: 'Правила и доступы',
    items: [
      { to: '/seasons', title: 'Сезоны', adminOnly: true },
      { to: '/directions', title: 'Направления', adminOnly: true },
      { to: '/criteria', title: 'Критерии оценки', adminOnly: true },
      { to: '/experts', title: 'Эксперты', adminOnly: true },
      { to: '/jury-members', title: 'Жюри', adminOnly: true },
      { to: '/settings', title: 'Настройки', adminOnly: true },
      { to: '/users', title: 'Пользователи', adminOnly: true },
      { to: '/audit', title: 'Журнал действий' },
    ],
  },
];

function AdminShell() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [session, setSession] = useState<AdminSessionInfo | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [idleWarning, setIdleWarning] = useState<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const location = useLocation();
  const navigate = useNavigate();

  const signOut = useCallback(
    async (message: string | null) => {
      await adminApi.logout().catch(() => undefined);
      setAdminToken(null);
      setSession(null);
      setNotice(message);
      setAuth('anonymous');
      navigate('/login', { replace: true });
    },
    [navigate]
  );

  const check = useCallback(async () => {
    if (!getAdminToken()) {
      setAuth('anonymous');
      return;
    }
    try {
      const result = await adminApi.verify();
      if (!result.valid) {
        setAdminToken(null);
        setSession(null);
        setAuth('anonymous');
        return;
      }
      setSession(result);
      setAuth('authenticated');
    } catch {
      setAuth('anonymous');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Счётчики внимания обновляются при каждом переходе по разделам (п. 1.7).
  useEffect(() => {
    if (auth !== 'authenticated') return;
    let active = true;
    void (async () => {
      try {
        const data = await adminApi.stats();
        if (active) setStats(data);
      } catch {
        // Сводка недоступна — меню продолжает работать без счётчиков.
      }
    })();
    return () => {
      active = false;
    };
  }, [auth, location.pathname]);

  useEffect(() => {
    if (auth !== 'authenticated' || !session) return;
    const idleMs = Math.max(5, session.idle_minutes) * 60_000;
    const markActivity = () => {
      lastActivityRef.current = Date.now();
      setIdleWarning(null);
    };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor > idleMs) {
        void signOut('Сеанс завершён из-за бездействия. Данные не сохранены — войдите заново.');
        return;
      }
      const left = Math.ceil((idleMs - idleFor) / 60_000);
      setIdleWarning(left <= 5 ? left : null);
      if (idleFor < 60_000) void adminApi.heartbeat().catch(() => undefined);
    }, 30_000);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(timer);
    };
  }, [auth, session, signOut]);

  const role: AdminUserRole = session?.role ?? 'admin';
  const isAdmin = role === 'admin';

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.adminOnly || isAdmin),
      })).filter((group) => group.items.length > 0),
    [isAdmin]
  );

  const currentTitle = useMemo(() => {
    for (const group of NAV_GROUPS) {
      const item = group.items.find(
        (candidate) => location.pathname === candidate.to || location.pathname.startsWith(`${candidate.to}/`)
      );
      if (item) return item.title;
    }
    return 'Админ-панель';
  }, [location.pathname]);

  if (auth === 'checking') {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <p role="status">Проверяем сессию администратора…</p>
      </main>
    );
  }

  if (auth === 'anonymous') {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <LoginPage
              notice={notice}
              onSuccess={async () => {
                setNotice(null);
                await check();
                navigate('/', { replace: true });
              }}
            />
          }
        />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-border bg-sand lg:min-h-screen lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="px-5 py-4">
          <Link to="/" className="mono-label">
            Админ-панель · Лидеры права – 2027
          </Link>
          <p className="mt-2 text-sm text-muted">
            {session?.full_name || session?.email || 'владелец платформы'}
            <br />
            {isAdmin ? 'администратор' : 'оператор'}
          </p>
        </div>
        <nav aria-label="Разделы админ-панели" className="px-2 pb-6">
          {groups.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="mono-label px-3 py-2 text-muted">{group.title}</p>
              <ul className="flex flex-col">
                {group.items.map((item) => {
                  const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                  const count = item.counter ? (stats?.attention?.[item.counter] ?? 0) : 0;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className={`flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-raised ${
                          active ? 'bg-raised text-accent' : ''
                        }`}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span>{item.title}</span>
                        {count > 0 ? (
                          <span className="mono-label border border-accent px-2 py-0.5 text-accent">{count}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1">
        <header className="border-b border-border bg-raised">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div>
              <p className="mono-label text-muted">Админ-панель</p>
              <p className="text-sm">
                <Link to="/" className="underline underline-offset-2 hover:text-accent">
                  Сводка
                </Link>
                {currentTitle === 'Сводка' ? null : (
                  <>
                    {' / '}
                    <span>{currentTitle}</span>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut('Вы вышли из админ-панели.')}
              className="text-sm text-accent underline underline-offset-2"
            >
              Выйти
            </button>
          </div>
          {!isAdmin ? (
            <p className="border-t border-border px-6 py-2 text-sm text-muted">
              Роль «оператор»: доступны заявки, материалы, обращения, мастер-классы, новости и документы. Настройки,
              справочники, эксперты, пользователи и публикация протоколов — только у администратора.
            </p>
          ) : null}
          {idleWarning !== null ? (
            <p role="status" className="border-t border-border px-6 py-2 text-sm text-danger">
              Сеанс завершится через {idleWarning} мин без действий. Сохраните изменения.
            </p>
          ) : null}
        </header>

        <main className="px-6 py-8">
          <Routes>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/" element={<DashboardPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:id" element={<ApplicationPage />} />
            <Route path="/materials" element={<MaterialsPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/evaluation" element={<EvaluationPage />} />
            <Route path="/evaluation/:teamId" element={<EvaluationPage />} />
            <Route path="/rankings" element={<RankingsPage canPublish={isAdmin} />} />
            <Route path="/appeals" element={<AppealsPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/users" element={<UsersPage currentUserId={session?.user_id ?? null} />} />
            {/* Справочники и контент: один экран на раздел, описанный конфигурацией. */}
            {RESOURCES.map((resource) => (
              <Route key={resource.key} path={`/${resource.key}`} element={<ResourceScreen config={resource} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    // basename совпадает с адресом развёртывания: ссылки разделов строятся как
    // /admin/applications, и обновление страницы не уводит в публичную часть.
    <BrowserRouter basename="/admin">
      <AdminShell />
    </BrowserRouter>
  );
}
