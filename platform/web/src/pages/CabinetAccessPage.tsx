import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, TextField } from '@/ui/primitives';

// Вход в личный кабинет. Пароля у команды нет: вход по ссылке-доступа либо по
// номеру заявки и адресу электронной почты капитана (решение Р7: письма не
// отправляются, поэтому ссылку можно получить заново только через Оргкомитет).

export function CabinetAccessPage() {
  const navigate = useNavigate();
  const [publicNumber, setPublicNumber] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Если сессия уже открыта, экран входа не нужен.
  useEffect(() => {
    let active = true;
    void api
      .cabinetSession()
      .then((session) => {
        if (active && session.authenticated) navigate('/cabinet', { replace: true });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate]);

  async function submitByNumber(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.cabinetAccessByNumber(publicNumber.trim(), email.trim());
      navigate('/cabinet', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось войти. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function submitByToken(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.cabinetAccessByToken(token.trim());
      navigate('/cabinet', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ссылка не подошла. Проверьте её и попробуйте снова.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Личный кабинет"
        title="Вход в кабинет команды"
        lead="Капитан команды входит по номеру заявки и адресу электронной почты, указанному при подаче. Пароль не нужен."
      />

      {error ? <Alert tone="danger" title="Войти не удалось">{error}</Alert> : null}

      <SectionCard
        title="Номер заявки и почта капитана"
        description="Номер заявки вида LP-2027-000123 выдаётся сразу после создания заявки на странице «Подать заявку»."
      >
        <form className="flex flex-col gap-5" onSubmit={submitByNumber} noValidate>
          <TextField
            id="public-number"
            label="Номер заявки"
            required
            value={publicNumber}
            onChange={(event) => setPublicNumber(event.target.value)}
            placeholder="LP-2027-000123"
            autoComplete="off"
            hint="Номер указан в подтверждении после создания заявки."
          />
          <TextField
            id="captain-email"
            label="Адрес электронной почты капитана команды"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" loading={busy}>
              Войти
            </Button>
            <button
              type="button"
              className="text-sm text-accent underline underline-offset-2"
              onClick={() => setShowTokenForm((value) => !value)}
            >
              Войти по ссылке доступа
            </button>
          </div>
        </form>
      </SectionCard>

      {showTokenForm ? (
        <SectionCard title="Вход по ссылке доступа" description="Ссылка выдаётся один раз при создании заявки или Оргкомитетом.">
          <form className="flex flex-col gap-5" onSubmit={submitByToken} noValidate>
            <TextField
              id="access-token"
              label="Ссылка или код доступа"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
            <Button type="submit" variant="secondary" loading={busy}>
              Войти по ссылке
            </Button>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard title="Не получается войти?" description="Письма конкурс не рассылает, поэтому восстановление идёт через Оргкомитет.">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>Проверьте номер заявки: он начинается с LP- и содержит год конкурса.</li>
          <li>
            Почта должна совпадать с почтой капитана команды, указанной при подаче. Изменить её может Оргкомитет.
          </li>
          <li>
            Напишите в Оргкомитет: руководитель Оргкомитета Тажибов Арслан Азизович, телефон 8 (966) 789-76-05,
            «ВКонтакте»{' '}
            <a className="text-accent underline underline-offset-2" href="https://vk.ru/id274466891">
              vk.ru/id274466891
            </a>
            , почта{' '}
            <a className="text-accent underline underline-offset-2" href="mailto:ssla_av@mail.ru">
              ssla_av@mail.ru
            </a>
            .
          </li>
        </ul>
      </SectionCard>

      <p className="text-sm text-muted">
        Ещё не подавали заявку?{' '}
        <Link to="/apply" className="text-accent underline underline-offset-2">
          Подать заявку
        </Link>
        .
      </p>
    </main>
  );
}
