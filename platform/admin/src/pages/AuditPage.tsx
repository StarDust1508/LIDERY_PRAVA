import { useCallback, useEffect, useState } from 'react';
import { AdminApiError, type AuditRecord, adminApi, formatMoscowHuman } from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, TextField } from '@shared/index';

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
};

export function AuditPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(
        await adminApi.audits({
          entity: entity || undefined,
          q: search.trim() || undefined,
          limit: 200,
        })
      );
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить журнал.');
    } finally {
      setLoading(false);
    }
  }, [entity, search]);

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

      <SectionCard title="Фильтры" description={`Записей в выборке: ${records.length}.`}>
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
          <div className="flex items-end">
            <Button type="submit" loading={loading}>
              Показать
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
                      <td className="py-2 pr-4 font-mono text-sm">{record.action}</td>
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
                  <p className="mt-1 font-mono">{record.action}</p>
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
    </main>
  );
}
