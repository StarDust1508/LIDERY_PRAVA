import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AdminApiError,
  type AdminApplicationRow,
  adminApi,
  formatMoscowHuman,
  TECH_STATUS_TITLES,
  teamStatusTitle,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField, TextField } from '@shared/index';
import { saveBlob } from '../lib/download';

// Список заявок: поиск по команде и организации, фильтр по статусу технической
// проверки, выгрузка CSV. Данные приходят из /api/admin/applications.

export function ApplicationsPage() {
  const [rows, setRows] = useState<AdminApplicationRow[]>([]);
  const [search, setSearch] = useState('');
  const [techStatus, setTechStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = { q: search.trim() || undefined, tech_status: techStatus || undefined, limit: 300 };
      setRows(await adminApi.applications(query));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить список заявок.');
    } finally {
      setLoading(false);
    }
  }, [search, techStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const blob = await adminApi.exportApplications({
        q: search.trim() || undefined,
        tech_status: techStatus || undefined,
      });
      saveBlob(blob, 'zayavki-lidery-prava.csv');
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось выгрузить CSV.');
    } finally {
      setExporting(false);
    }
  }

  const newCount = rows.filter((row) => row.tech_status === 'pending').length;
  const fixCount = rows.filter((row) => row.tech_status === 'fix_required').length;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Техническая проверка"
        title="Заявки"
        lead="Заявки приходят только с сайта. Здесь — проверка комплектности, допуск к экспертизе и выгрузка для Оргкомитета."
        aside={
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void load()} loading={loading}>
              Обновить
            </Button>
            <Button variant="secondary" onClick={() => void exportCsv()} loading={exporting}>
              Выгрузить CSV
            </Button>
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard title="Фильтры" description={`Всего заявок в выборке: ${rows.length}; ожидают проверки: ${newCount}; требуют исправлений: ${fixCount}.`}>
        <form
          className="grid gap-4 md:grid-cols-[2fr,1fr,auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <TextField
            id="applications-search"
            label="Поиск по команде или организации"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Например, Веб Команда"
          />
          <SelectField
            id="applications-status"
            label="Статус технической проверки"
            value={techStatus}
            onChange={(event) => setTechStatus(event.target.value)}
            placeholder="Все статусы"
            options={Object.entries(TECH_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
          />
          <div className="flex items-end">
            <Button type="submit" loading={loading}>
              Найти
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Заявки" description="Нажмите на команду, чтобы открыть карточку заявки целиком.">
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-muted">По этим условиям заявок нет.</p>
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <caption className="sr-only-text">Список заявок конкурса</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">№</th>
                  <th scope="col" className="py-2 pr-4">Команда</th>
                  <th scope="col" className="py-2 pr-4">Направление</th>
                  <th scope="col" className="py-2 pr-4">Подана</th>
                  <th scope="col" className="py-2 pr-4">Техпроверка</th>
                  <th scope="col" className="py-2 pr-4">Статус команды</th>
                  <th scope="col" className="py-2 pr-4">Участники</th>
                  <th scope="col" className="py-2">Материалы</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="py-2 pr-4 font-mono">{row.id}</td>
                    <td className="py-2 pr-4">
                      <Link to={`/applications/${row.id}`} className="text-accent underline underline-offset-2">
                        {row.team_name}
                      </Link>
                      {row.organization ? <span className="block text-muted">{row.organization}</span> : null}
                    </td>
                    <td className="py-2 pr-4">{row.direction_title ?? '—'}</td>
                    <td className="py-2 pr-4">{row.submitted_at ? formatMoscowHuman(row.submitted_at) : 'черновик'}</td>
                    <td className="py-2 pr-4">{TECH_STATUS_TITLES[row.tech_status] ?? row.tech_status}</td>
                    <td className="py-2 pr-4">{teamStatusTitle(row.team_status)}</td>
                    <td className="py-2 pr-4">
                      {row.participants_count} / {row.mentors_count}
                    </td>
                    <td className="py-2">{row.materials_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* На узких экранах таблица превращается в карточки (ТЗ 08, п. 3.6):
                горизонтальной прокрутки на мобильных быть не должно. */}
            <ul className="flex flex-col gap-4 md:hidden">
              {rows.map((row) => (
                <li key={`card-${row.id}`} className="border border-border p-4 text-sm">
                  <Link to={`/applications/${row.id}`} className="text-accent underline underline-offset-2">
                    {row.team_name}
                  </Link>
                  <p className="mt-1 text-muted">{row.direction_title ?? 'направление не выбрано'}</p>
                  <dl className="mt-3 flex flex-col gap-1">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Подана</dt>
                      <dd>{row.submitted_at ? formatMoscowHuman(row.submitted_at) : 'черновик'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Техпроверка</dt>
                      <dd>{TECH_STATUS_TITLES[row.tech_status] ?? row.tech_status}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Статус команды</dt>
                      <dd>{teamStatusTitle(row.team_status)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Участники / наставники</dt>
                      <dd>
                        {row.participants_count} / {row.mentors_count}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Материалов</dt>
                      <dd>{row.materials_count}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>
    </main>
  );
}
