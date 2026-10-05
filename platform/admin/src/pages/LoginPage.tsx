import { useState } from 'react';
import { AdminApiError, adminApi, setAdminToken } from '@shared/index';
import { Alert, Button, SectionCard, TextField } from '@shared/index';

// Вход в админ-панель (ТЗ 07, п. 1.2). Два способа:
//   • адрес электронной почты и пароль учётной записи — так работают несколько
//     человек и различаются роли (`admin` / `operator`);
//   • общий логин и пароль из окружения — резервный доступ владельца платформы.
// Сессия живёт 12 часов и завершается после 60 минут бездействия.

export function LoginPage({
  onSuccess,
  notice,
}: {
  onSuccess: (role: 'admin' | 'operator') => void;
  notice?: string | null;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await adminApi.login(login.trim(), password);
      setAdminToken(result.token);
      onSuccess(result.role ?? 'admin');
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось войти.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col justify-center gap-6 px-6 py-12">
      <header>
        <p className="mono-label text-muted">Лидеры права – 2027</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Вход в админ-панель</h1>
        <p className="mt-2 text-muted">
          Доступ для Оргкомитета: заявки, материалы, техническая проверка, оценки и публикация протоколов.
        </p>
      </header>

      {notice ? <Alert tone="info" title="Сеанс завершён">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="Войти не удалось">{error}</Alert> : null}

      <SectionCard
        title="Электронная почта и пароль"
        description="Рабочая учётная запись Оргкомитета. Права зависят от роли: администратор или оператор."
      >
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          <TextField
            id="admin-login"
            label="Электронная почта или общий логин"
            type="text"
            required
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            autoComplete="username"
            hint="Например: ivanov@lideryprava.ru"
          />
          <TextField
            id="admin-password"
            label="Пароль"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <Button type="submit" loading={busy}>
            Войти
          </Button>
        </form>
      </SectionCard>

      <p className="text-sm text-muted">
        Сеанс действует 12 часов и завершается после 60 минут бездействия. Все попытки входа записываются в журнал:
        событие, время, сетевой адрес и логин — без персональных данных заявителей.
      </p>
    </main>
  );
}
