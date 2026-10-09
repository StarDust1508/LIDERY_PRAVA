import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminApiError, adminApi, formatMoscowHuman, type AdminUser, type AdminUserRole } from '@shared/index';
import { Alert, Button, SectionCard, SelectField, TextField } from '@shared/index';

// Небольшая метка состояния: в дизайн-системе есть только StatusBadge для
// статусов заявок, поэтому здесь — тот же визуальный язык, но с явным тоном.
function Tag({ tone, children }: { tone: 'success' | 'danger' | 'neutral'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    success: 'border-success text-success',
    danger: 'border-danger text-danger',
    neutral: 'border-border-strong text-muted',
  };
  return <span className={`mono-label inline-flex border px-2 py-1 ${styles[tone]}`}>{children}</span>;
}

// Пользователи админ-панели (ТЗ 07, п. 2.17). Раздел доступен только роли
// «администратор»: сервер отвечает 403 оператору, поэтому ссылка в меню ему не
// показывается. Здесь — создание учётной записи, смена роли, блокировка,
// сброс пароля и завершение всех сеансов.

const ROLE_TITLES: Record<AdminUserRole, string> = {
  admin: 'Администратор',
  operator: 'Оператор',
};

const ROLE_HINTS: Record<AdminUserRole, string> = {
  admin: 'Все разделы: заявки, оценки, публикация протоколов, настройки, эксперты, пользователи.',
  operator: 'Заявки, материалы, обращения, мастер-классы, новости и документы. Без настроек, экспертов, пользователей и публикации протоколов.',
};

const PASSWORD_HINT = 'Не короче 12 символов, хотя бы одна буква и одна цифра.';

export function UsersPage({ currentUserId }: { currentUserId: number | null }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  // Блокировка — решение, которое закрывает человеку доступ: подтверждаем и
  // требуем причину, иначе в журнале у всех блокировок один и тот же текст.
  const [blockTarget, setBlockTarget] = useState<AdminUser | null>(null);
  const [blockReason, setBlockReason] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<AdminUserRole>('operator');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await adminApi.users({ q: search.trim(), role: roleFilter }));
      // Полный список — отдельным запросом без фильтров: он нужен счётчику
      // «действующих администраторов» и защите от потери последнего админа.
      setAllUsers(await adminApi.users());
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить пользователей.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Счётчик считается по полному списку: при фильтре «Оператор» или поиске он
  // показывал произвольное число, вплоть до нуля.
  const activeAdmins = useMemo(
    () => allUsers.filter((user) => user.role === 'admin' && user.is_active).length,
    [allUsers]
  );

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setCreating(true);
    try {
      const created = await adminApi.createUser({
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
        full_name: newName.trim() || null,
      });
      setNotice(
        `Учётная запись ${created.email} создана. Пароль помечен временным: при первом входе система попросит его заменить.`
      );
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось создать учётную запись.');
    } finally {
      setCreating(false);
    }
  }

  async function run(user: AdminUser, action: () => Promise<string>) {
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Действие не выполнено.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="mono-label text-muted">Доступ</p>
        <h1 className="mt-2 text-h2 font-semibold tracking-[var(--tr-heading)]">Пользователи админ-панели</h1>
        <p className="mt-2 max-w-measure text-muted">
          Раздел только для роли «администратор». Пароли хранятся в виде bcrypt-хэша (cost 12) и не показываются
          нигде, включая журнал. Действующих администраторов: {activeAdmins}.
        </p>
      </header>

      {notice ? <Alert tone="success" title="Готово">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="Не удалось выполнить">{error}</Alert> : null}

      <SectionCard
        title="Новая учётная запись"
        description="Пароль передайте сотруднику по защищённому каналу: он временный и подлежит замене при первом входе."
      >
        <form className="grid gap-5 md:grid-cols-2" onSubmit={createUser} noValidate>
          <TextField
            id="user-email"
            label="Электронная почта"
            type="email"
            required
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            autoComplete="off"
          />
          <TextField
            id="user-name"
            label="ФИО"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            hint="Необязательно: подпись в журнале действий."
          />
          <SelectField
            id="user-role"
            label="Роль"
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as AdminUserRole)}
            options={[
              { value: 'operator', title: ROLE_TITLES.operator },
              { value: 'admin', title: ROLE_TITLES.admin },
            ]}
            hint={ROLE_HINTS[newRole]}
          />
          <TextField
            id="user-password"
            label="Временный пароль"
            type="password"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            hint={PASSWORD_HINT}
          />
          <div className="md:col-span-2">
            <Button type="submit" loading={creating}>
              Создать учётную запись
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Список учётных записей" description="Фильтры сохраняются в адресной строке только для выборки.">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end">
          <div className="md:w-80">
            <TextField
              id="user-search"
              label="Поиск"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Почта или ФИО"
            />
          </div>
          <div className="md:w-64">
            <SelectField
              id="user-role-filter"
              label="Роль"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              options={[
                { value: 'admin', title: ROLE_TITLES.admin },
                { value: 'operator', title: ROLE_TITLES.operator },
              ]}
              placeholder="Все роли"
            />
          </div>
        </div>

        {loading ? <p role="status">Загружаем учётные записи…</p> : null}
        {!loading && users.length === 0 ? (
          <p className="text-muted">Учётных записей нет. Создайте первую — она появится в этом списке.</p>
        ) : null}

        {users.length > 0 ? (
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-2 pr-4">Почта и ФИО</th>
                  <th className="py-2 pr-4">Роль</th>
                  <th className="py-2 pr-4">Состояние</th>
                  <th className="py-2 pr-4">Последний вход</th>
                  <th className="py-2 pr-4">Сеансы</th>
                  <th className="py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border align-top">
                    <td className="py-3 pr-4">
                      <span className="font-mono">{user.email}</span>
                      {user.full_name ? <span className="block text-muted">{user.full_name}</span> : null}
                      {user.id === currentUserId ? <Tag tone="neutral">это вы</Tag> : null}
                    </td>
                    <td className="py-3 pr-4">{ROLE_TITLES[user.role]}</td>
                    <td className="py-3 pr-4">
                      {user.is_active ? <Tag tone="success">активна</Tag> : <Tag tone="danger">заблокирована</Tag>}
                      {user.must_change_password ? <span className="block text-muted">пароль временный</span> : null}
                      {user.blocked_reason ? <span className="block text-muted">{user.blocked_reason}</span> : null}
                    </td>
                    <td className="py-3 pr-4">{user.last_login_at ? formatMoscowHuman(user.last_login_at) : 'не входил'}</td>
                    <td className="py-3 pr-4">{user.active_sessions}</td>
                    <td className="py-3">
                      <UserActions
                        user={user}
                        busy={busyId === user.id}
                        run={run}
                        isSelf={user.id === currentUserId}
                        onBlockRequest={(target) => {
                          setBlockTarget(target);
                          setBlockReason('');
                          setError(null);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {users.length > 0 ? (
          <ul className="flex flex-col gap-4 md:hidden">
            {users.map((user) => (
              <li key={user.id} className="border border-border p-4">
                <p className="font-mono">{user.email}</p>
                {user.full_name ? <p className="text-muted">{user.full_name}</p> : null}
                <p className="mt-2">
                  {ROLE_TITLES[user.role]} · {user.is_active ? 'активна' : 'заблокирована'} · сеансов:{' '}
                  {user.active_sessions}
                </p>
                <div className="mt-3">
                  <UserActions
                        user={user}
                        busy={busyId === user.id}
                        run={run}
                        isSelf={user.id === currentUserId}
                        onBlockRequest={(target) => {
                          setBlockTarget(target);
                          setBlockReason('');
                          setError(null);
                        }}
                      />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      {blockTarget !== null ? (
        <SectionCard title={`Заблокировать учётную запись ${blockTarget.email}?`}>
          <p className="text-sm text-muted">
            Доступ в админ-панель закроется сразу, выданные сеансы завершатся. Причина попадёт в журнал действий —
            она нужна, чтобы через месяц было понятно, почему доступ закрыли.
          </p>
          <div className="mt-4 max-w-measure">
            <TextField
              id="block-reason"
              label="Причина блокировки"
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              hint="Например: увольнение, окончание срока полномочий, решение Оргкомитета от 12 октября."
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              loading={busyId === blockTarget.id}
              disabled={blockReason.trim().length < 3}
              onClick={() => {
                const target = blockTarget;
                void run(target, async () => {
                  await adminApi.updateUser(target.id, {
                    is_active: false,
                    blocked_reason: blockReason.trim(),
                  });
                  return `${target.email} заблокирована, выданные сеансы завершены.`;
                }).then(() => {
                  setBlockTarget(null);
                  setBlockReason('');
                });
              }}
            >
              Заблокировать
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setBlockTarget(null);
                setBlockReason('');
              }}
            >
              Отменить
            </Button>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function UserActions({
  user,
  busy,
  run,
  isSelf,
  onBlockRequest,
}: {
  user: AdminUser;
  busy: boolean;
  run: (user: AdminUser, action: () => Promise<string>) => Promise<void>;
  isSelf: boolean;
  /** Открыть подтверждение блокировки: причина вводится в диалоге. */
  onBlockRequest: (user: AdminUser) => void;
}) {
  const nextRole: AdminUserRole = user.role === 'admin' ? 'operator' : 'admin';

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        loading={busy}
        disabled={isSelf && user.role === 'admin'}
        title={isSelf ? 'Нельзя понизить собственную роль' : undefined}
        onClick={() =>
          void run(user, async () => {
            await adminApi.updateUser(user.id, { role: nextRole });
            return `${user.email}: роль изменена на «${ROLE_TITLES[nextRole]}».`;
          })
        }
      >
        Сделать {nextRole === 'admin' ? 'администратором' : 'оператором'}
      </Button>

      <Button
        type="button"
        variant="secondary"
        loading={busy}
        disabled={user.is_active && isSelf}
        className={user.is_active ? 'border-danger text-danger' : undefined}
        title={user.is_active && isSelf ? 'Нельзя заблокировать собственную учётную запись' : undefined}
        onClick={() => {
          if (user.is_active) {
            onBlockRequest(user);
            return;
          }
          void run(user, async () => {
            await adminApi.updateUser(user.id, { is_active: true });
            return `${user.email} разблокирована.`;
          });
        }}
      >
        {user.is_active ? 'Заблокировать' : 'Разблокировать'}
      </Button>

      <Button
        type="button"
        variant="secondary"
        loading={busy}
        onClick={() =>
          void run(user, async () => {
            const password = window.prompt(
              `Новый временный пароль для ${user.email}\n${PASSWORD_HINT}\n\nПароль будет показан только сейчас.`
            );
            if (!password) throw new AdminApiError(0, 'Сброс пароля отменён.');
            await adminApi.resetUserPassword(user.id, password);
            return `Пароль для ${user.email} заменён, все сеансы завершены.`;
          })
        }
      >
        Сбросить пароль
      </Button>

      <Button
        type="button"
        variant="secondary"
        loading={busy}
        onClick={() =>
          void run(user, async () => {
            const result = await adminApi.revokeUserSessions(user.id);
            return result.self
              ? 'Все сеансы, включая текущий, завершены. Войдите заново.'
              : `Все сеансы ${user.email} завершены.`;
          })
        }
      >
        Завершить сеансы
      </Button>
    </div>
  );
}
