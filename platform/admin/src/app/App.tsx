import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { adminApi, getAdminToken, setAdminToken, type AdminSessionInfo, type AdminUserRole } from '@shared/index';
import { ApplicationPage } from '../pages/ApplicationPage';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import { AuditPage } from '../pages/AuditPage';
import { EvaluationPage } from '../pages/EvaluationPage';
import { LoginPage } from '../pages/LoginPage';
import { RankingsPage } from '../pages/RankingsPage';
import { UsersPage } from '../pages/UsersPage';

// Админ-панель — отдельная сборка (ТЗ 03, 07). Доступ закрыт сессией: без
// проверки токена не отображается ни один раздел и не запрашиваются данные.
//
// Роли (ТЗ 07, п. 1.3): оператор ведёт заявки, материалы, обращения,
// мастер-классы, новости и документы. Разделы «Пользователи» и «Журнал»
// доступны только администратору — как и публикация протокола внутри «Рейтинга».
// Каждый такой раздел всё равно закрыт на сервере: интерфейс лишь не показывает
// то, что всё равно вернёт 403.
//
// Бездействие (ТЗ 07, п. 1.2): сервер завершает сеанс после 60 минут без
// обращений. Интерфейс следит за этим сам — заранее показывает предупреждение и
// отправляет отметку активности, пока пользователь работает.

type AuthState = 'checking' | 'authenticated' | 'anonymous';

const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

function AdminShell() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [session, setSession] = useState<AdminSessionInfo | null>(null);
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

  /**
   * Проверка сессии. Тихо выходит, если сервер ответил 401: токен истёк по
   * сроку или сеанс завершён из-за бездействия — сообщение приходит с сервера.
   */
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

  // Отметка активности и предупреждение за 5 минут до автоматического выхода.
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
      // Раз в минуту подтверждаем активность на сервере, чтобы окно не закрылось
      // во время долгой работы с одной формой.
      if (idleFor < 60_000) void adminApi.heartbeat().catch(() => undefined);
    }, 30_000);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(timer);
    };
  }, [auth, session, signOut]);

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
                navigate('/applications', { replace: true });
              }}
            />
          }
        />
      </Routes>
    );
  }

  const role: AdminUserRole = session?.role ?? 'admin';
  const isAdmin = role === 'admin';
  const isActive = (prefix: string) => (location.pathname.startsWith(prefix) ? 'text-accent' : 'text-fg');

  const links: Array<{ to: string; title: string; adminOnly?: boolean }> = [
    { to: '/applications', title: 'Заявки' },
    { to: '/evaluation', title: 'Оценки' },
    { to: '/rankings', title: 'Рейтинг' },
    { to: '/audit', title: 'Журнал' },
    { to: '/users', title: 'Пользователи', adminOnly: true },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-raised">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <Link to="/applications" className="mono-label">
              Админ-панель · Лидеры права – 2027
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm" aria-label="Разделы админ-панели">
              {links
                .filter((link) => !link.adminOnly || isAdmin)
                .map((link) => (
                  <Link key={link.to} to={link.to} className={`underline underline-offset-2 ${isActive(link.to)}`}>
                    {link.title}
                  </Link>
                ))}
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted">
              {session?.full_name || session?.email || 'владелец платформы'} · {isAdmin ? 'администратор' : 'оператор'}
            </span>
            <button
              type="button"
              onClick={() => void signOut('Вы вышли из админ-панели.')}
              className="text-accent underline underline-offset-2"
            >
              Выйти
            </button>
          </div>
        </div>
        {!isAdmin ? (
          <p className="mx-auto max-w-container px-6 pb-3 text-sm text-muted">
            Роль «оператор»: доступны заявки, материалы, обращения, мастер-классы, новости и документы. Настройки,
            эксперты, пользователи и публикация протоколов — только у администратора.
          </p>
        ) : null}
        {idleWarning !== null ? (
          <p role="status" className="mx-auto max-w-container px-6 pb-3 text-sm text-danger">
            Сеанс завершится через {idleWarning} мин без действий. Сохраните изменения.
          </p>
        ) : null}
      </header>

      <main className="mx-auto max-w-container px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/applications" replace />} />
          <Route path="/login" element={<Navigate to="/applications" replace />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/applications/:id" element={<ApplicationPage />} />
          <Route path="/evaluation" element={<EvaluationPage />} />
          <Route path="/evaluation/:teamId" element={<EvaluationPage />} />
          <Route path="/rankings" element={<RankingsPage canPublish={isAdmin} />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/users" element={<UsersPage currentUserId={session?.user_id ?? null} />} />
          <Route path="*" element={<Navigate to="/applications" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AdminShell />
    </BrowserRouter>
  );
}
