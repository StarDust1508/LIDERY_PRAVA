import { useState } from 'react';
import { AdminApiError, adminApi, setAdminToken } from '@shared/index';
import { Alert, Button, SectionCard, TextField } from '@shared/index';

// Вход администратора: логин и пароль из окружения, дальше — HMAC-токен сессии.
export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
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
      onSuccess();
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
        <p className="mt-2 text-muted">Доступ для Оргкомитета: заявки, техническая проверка, оценки и публикация протоколов.</p>
      </header>

      {error ? <Alert tone="danger" title="Войти не удалось">{error}</Alert> : null}

      <SectionCard title="Логин и пароль" description="Пароль задаётся в переменных окружения сервера.">
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          <TextField id="admin-login" label="Логин" required value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" />
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
        Все попытки входа записываются в журнал: событие, сетевой адрес и логин (без персональных данных заявителей).
      </p>
    </main>
  );
}
