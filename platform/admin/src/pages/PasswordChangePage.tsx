import { useState } from 'react';
import { AdminApiError, adminApi } from '@shared/index';
import { Alert, Button, TextField } from '@shared/index';

// Смена временного пароля (ТЗ 11, п. 45).
//
// Администратор выдаёт временный пароль, и до этой правки флаг «пароль
// временный» ничего не менял: сменить пароль было негде. Пока пароль временный,
// панель показывает этот экран вместо разделов, а после смены просит войти
// заново — прежние сеансы завершаются.

interface PasswordChangePageProps {
  email: string | null;
  onDone: (message: string) => void | Promise<void>;
}

export function PasswordChangePage({ email, onDone }: PasswordChangePageProps) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== repeat) {
      setError('Новый пароль и повтор не совпадают.');
      return;
    }
    setBusy(true);
    try {
      await adminApi.changeOwnPassword({ current_password: current, new_password: next });
      await onDone('Пароль изменён. Войдите заново с новым паролем.');
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось изменить пароль.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-12">
      <header>
        <p className="mono-label text-muted">Безопасность</p>
        <h1 className="mt-2 text-h2 font-semibold tracking-[var(--tr-heading)]">Замените временный пароль</h1>
        <p className="mt-2 max-w-measure text-muted">
          Пароль для учётной записи {email ?? 'администратора'} выдан администратором и считается временным. Придумайте
          свой пароль: не короче 10 символов, с буквами и цифрами, не совпадающий с адресом почты. После смены все
          прежние сеансы завершатся, и вы войдёте заново.
        </p>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <form className="flex max-w-measure flex-col gap-5" onSubmit={submit}>
        <TextField
          id="password-current"
          label="Текущий (временный) пароль"
          type="password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <TextField
          id="password-new"
          label="Новый пароль"
          type="password"
          required
          value={next}
          onChange={(event) => setNext(event.target.value)}
          hint="Не короче 10 символов, содержит буквы и цифры."
        />
        <TextField
          id="password-repeat"
          label="Повторите новый пароль"
          type="password"
          required
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
        <div>
          <Button type="submit" loading={busy} disabled={current === '' || next === ''}>
            Сохранить пароль
          </Button>
        </div>
      </form>
    </main>
  );
}
