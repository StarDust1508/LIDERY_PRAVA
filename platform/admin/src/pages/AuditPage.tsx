import { useCallback, useEffect, useState } from 'react';
import { AdminApiError, type AuditRecord, adminApi, formatMoscowHuman } from '@shared/index';
import { saveBlob } from '../lib/download';
import { Alert, Button, PageHeader, SectionCard, SelectField, TextField } from '@shared/index';

// Журнал действий: кто, что и когда изменил (ТЗ 07, п. 2.16–2.17).
// Записи создаются автоматически на каждый успешный изменяющий запрос админки,
// поэтому забыть про журналирование отдельного действия невозможно.

const ENTITY_TITLES: Record<string, string> = {
  applications: 'Заявки',
  materials: 'Материалы',
  teams: 'Команды',
  participants: 'Участники',
  mentors: 'Наставники',
  evaluations: 'Оценки',
  rankings: 'Рейтинг',
  appeals: 'Апелляции',
  leads: 'Обращения',
  settings: 'Настройки',
  media: 'Файлы',
  documents: 'Документы',
  winners: 'Победители',
  initiatives: 'Архив законопроектов',
  users: 'Пользователи',
  auth: 'Вход в админ-панель',
};

/** Названия действий для человека: код в журнале читать невозможно. */
const ACTION_TITLES: Record<string, string> = {
  application_accept: 'Заявка принята',
  application_reject: 'Заявка отклонена',
  application_update: 'Заявка изменена',
  applications_bulk_review: 'Массовая техническая проверка',
  material_review: 'Решение по материалу',
  materials_bulk_review: 'Массовое решение по материалам',
  ranking_publish: 'Протокол опубликован',
  rankings_publish: 'Протокол опубликован',
  rankings_unpublish: 'Протокол снят с публикации',
  rankings_recalculate: 'Рейтинг пересчитан',
  evaluation_save: 'Оценка сохранена',
  evaluation_delete: 'Оценка удалена',
  appeal_decide: 'Решение по апелляции',
  appeal_submitted: 'Апелляция подана',
  lead_respond: 'Ответ на обращение',
  setting_update: 'Настройка изменена',
  settings_update: 'Настройка изменена',
  user_create: 'Учётная запись создана',
  user_update: 'Учётная запись изменена',
  user_password_reset: 'Пароль сброшен',
  user_sessions_revoked: 'Сеансы завершены',
  team_status: 'Статус команды изменён',
  team_token_issue: 'Ссылка доступа выдана',
  team_token_revoke: 'Ссылка доступа отозвана',
  media_upload: 'Файл загружен',
  media_delete: 'Файл удалён',
  media_grant_link: 'Выдана ссылка на файл',
  document_update: 'Документ изменён',
  initiative_publish: 'Инициатива опубликована',
  initiatives_import: 'Импорт архива',
  pdn_export: 'Выгрузка сведений субъекта',
  pdn_erase: 'Обезличивание по требованию',
  legacy_export: 'Выгрузка архива 2026',
  expert_access_issued: 'Доступ эксперта выдан',
  expert_access_revoked: 'Доступ эксперта отозван',
};

/** Подпись действия: известные коды переводим, остальные показываем как есть. */
function actionTitle(action: unknown): string {
  const code = String(action ?? '');
  return ACTION_TITLES[code] ?? code;
}

export function AuditPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  // Фильтры ТЗ 07, п. 2.17: по пользователю и действию, а не только по объекту
  // и периоду. Сервер их поддерживал, но панель не отправляла.
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<Array<{ id: number; full_name: string | null; email: string }>>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const perPage = 50;
  // Фильтры по периоду и выгрузка (ТЗ 07, п. 2.17).
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.auditsPage({
        entity: entity || undefined,
        action: action.trim() || undefined,
        q: search.trim() || undefined,
        user_id: userId ? Number(userId) : undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        perPage,
      });
      setRecords(result.data);
      setTotal(result.meta?.total ?? result.data.length);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить журнал.');
    } finally {
      setLoading(false);
    }
  }, [entity, search, action, userId, from, to, page]);

  /** Выгрузка журнала с текущими фильтрами: файл отдаёт сервер. */
  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      // Выгрузка идёт с токеном админ-сессии, поэтому файл берём запросом,
      // а не ссылкой: ссылка не передаёт заголовок Authorization.
      const blob = await adminApi.exportAudit({
        entity: entity || undefined,
        action: action.trim() || undefined,
        q: search.trim() || undefined,
        user_id: userId ? Number(userId) : undefined,
        from: from || undefined,
        to: to || undefined,
      });
      saveBlob(blob, `audit-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выгрузить журнал.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const list = await adminApi.users();
        setUsers(list.map((user) => ({ id: user.id, full_name: user.full_name ?? null, email: user.email })));
      } catch {
        // Без списка пользователей фильтр просто остаётся пустым.
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Журнал"
        title="Действия администраторов"
        lead="Каждое изменение данных фиксируется с автором, временем, сетевым адресом и результатом. Чтение не журналируется: входы учитываются отдельно."
        aside={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            Обновить
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard
        title="Фильтры"
        description={`Найдено записей: ${total}. На странице: ${records.length} (с ${total === 0 ? 0 : (page - 1) * perPage + 1} по ${Math.min(page * perPage, total)}).`}
      >
        <form
          className="grid gap-4 md:grid-cols-[1fr,1fr,auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <TextField
            id="audit-search"
            label="Поиск по автору или идентификатору"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="env:owner, user:3, 42"
          />
          <TextField
            id="audit-entity"
            label="Сущность"
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            placeholder="applications, rankings, settings"
          />
          <TextField
            id="audit-action"
            label="Действие"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="rankings_publish, application_accept"
            hint="Часть кода действия; пусто — все действия."
          />
          <SelectField
            id="audit-user"
            label="Пользователь"
            value={userId}
            options={users.map((user) => ({
              value: user.id,
              title: user.full_name ? `${user.full_name} (${user.email})` : user.email,
            }))}
            placeholder="Все пользователи"
            onChange={(event) => setUserId(event.target.value)}
          />
          <TextField
            id="audit-from"
            label="С даты"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            id="audit-to"
            label="По дату"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <div className="flex items-end gap-3">
            <Button type="submit" loading={loading}>
              Показать
            </Button>
            <Button type="button" variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
              Выгрузить CSV
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Записи" description="Новые сверху. В поле «Результат» — ответ системы после изменения.">
        {records.length === 0 && !loading ? (
          <p className="text-sm text-muted">Записей нет. Журнал заполняется, когда администратор меняет данные.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <caption className="sr-only-text">Журнал действий администраторов</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4">Когда</th>
                    <th scope="col" className="py-2 pr-4">Кто</th>
                    <th scope="col" className="py-2 pr-4">Действие</th>
                    <th scope="col" className="py-2 pr-4">Объект</th>
                    <th scope="col" className="py-2 pr-4">Адрес</th>
                    <th scope="col" className="py-2">Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-border align-top">
                      <td className="py-2 pr-4">{formatMoscowHuman(record.created_at)}</td>
                      <td className="py-2 pr-4">
                        {record.user_name ?? record.actor_label ?? record.actor_type}
                      </td>
                      <td className="py-2 pr-4 text-sm" title={String(record.action ?? '')}>
                        {actionTitle(record.action)}
                      </td>
                      <td className="py-2 pr-4">
                        {ENTITY_TITLES[record.entity] ?? record.entity}
                        {record.entity_id ? ` № ${record.entity_id}` : ''}
                      </td>
                      <td className="py-2 pr-4 font-mono">{record.ip ?? '—'}</td>
                      <td className="py-2 max-w-measure break-words text-muted">
                        {record.after ? JSON.stringify(record.after).slice(0, 200) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* На узких экранах таблица превращается в карточки (ТЗ 08, п. 3.6). */}
            <ul className="flex flex-col gap-4 md:hidden">
              {records.map((record) => (
                <li key={`card-${record.id}`} className="border border-border p-4 text-sm">
                  <p className="mono-label text-muted">{formatMoscowHuman(record.created_at)}</p>
                  <p className="mt-1">{actionTitle(record.action)}</p>
                  <p className="mt-2">
                    {ENTITY_TITLES[record.entity] ?? record.entity}
                    {record.entity_id ? ` № ${record.entity_id}` : ''}
                  </p>
                  <p className="mt-1 text-muted">
                    {record.user_name ?? record.actor_label ?? record.actor_type} · {record.ip ?? '—'}
                  </p>
                  {record.after ? (
                    <p className="mt-2 break-words text-muted">{JSON.stringify(record.after).slice(0, 200)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      {total > perPage ? (
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Постраничная навигация">
          <span className="text-sm text-muted">
            Страница {page} из {Math.max(1, Math.ceil(total / perPage))}
          </span>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Назад
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= Math.ceil(total / perPage) || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Вперёд
            </Button>
          </div>
        </nav>
      ) : null}
    </main>
  );
}
