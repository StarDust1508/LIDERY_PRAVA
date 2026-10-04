import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { adminApi, setAdminToken } from '@shared/index';
import { ApplicationPage } from '../pages/ApplicationPage';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import { EvaluationPage } from '../pages/EvaluationPage';
import { LoginPage } from '../pages/LoginPage';
import { RankingsPage } from '../pages/RankingsPage';

// Админ-панель — отдельная сборка (ТЗ 03). Доступ закрыт сессией администратора:
// без проверки токена не отображается ни один раздел, а данные не запрашиваются.

type AuthState = 'checking' | 'authenticated' | 'anonymous';

function AdminShell() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const location = useLocation();
  const navigate = useNavigate();

  const check = useCallback(async () => {
    try {
      const result = await adminApi.verify();
      setAuth(result.valid ? 'authenticated' : 'anonymous');
    } catch {
      setAuth('anonymous');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    setAdminToken(null);
    setAuth('anonymous');
    navigate('/login', { replace: true });
  }

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
              onSuccess={() => {
                setAuth('authenticated');
                navigate('/applications', { replace: true });
              }}
            />
          }
        />
      </Routes>
    );
  }

  const isActive = (prefix: string) => (location.pathname.startsWith(prefix) ? 'text-accent' : 'text-fg');

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-raised">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <Link to="/applications" className="mono-label">
              Админ-панель · Лидеры права – 2027
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm" aria-label="Разделы админ-панели">
              <Link to="/applications" className={`underline underline-offset-2 ${isActive('/applications')}`}>
                Заявки
              </Link>
              <Link to="/evaluation" className={`underline underline-offset-2 ${isActive('/evaluation')}`}>
                Оценки
              </Link>
              <Link to="/rankings" className={`underline underline-offset-2 ${isActive('/rankings')}`}>
                Рейтинг
              </Link>
            </nav>
          </div>
          <button type="button" onClick={() => void logout()} className="text-sm text-accent underline underline-offset-2">
            Выйти
          </button>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/applications" replace />} />
        <Route path="/login" element={<Navigate to="/applications" replace />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/applications/:id" element={<ApplicationPage />} />
        <Route path="/evaluation" element={<EvaluationPage />} />
        <Route path="/evaluation/:teamId" element={<EvaluationPage />} />
        <Route path="/rankings" element={<RankingsPage />} />
        <Route path="*" element={<Navigate to="/applications" replace />} />
      </Routes>
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
