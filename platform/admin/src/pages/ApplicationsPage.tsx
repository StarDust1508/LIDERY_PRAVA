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
  // Фильтры приёмной кампании (ТЗ 07, п. 2.2): сезон, направление, источник,
  // период подачи и наличие замечаний. Раньше был только статус проверки.
  const [seasonId, setSeasonId] = useState('');
  const [directionId, setDirectionId] = useState('');
  const [source, setSource] = useState('');
  const [submittedFrom, setSubmittedFrom] = useState('');
  const [submittedTo, setSubmittedTo] = useState('');
  const [hasRemarks, setHasRemarks] = useState('');
  const [seasons, setSeasons] = useState<Array<{ id: number; title: string }>>([]);
  const [directions, setDirections] = useState<Array<{ id: number; title: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  // Массовая техническая проверка (ТЗ 07, п. 3.3): выбор строк, предпросмотр,
  // подтверждение. Предпросмотр обязателен — Оргкомитет видит, что изменится.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('accepted');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkPreview, setBulkPreview] = useState<{ affected: number; rows: Array<Record<string, unknown>> } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = {
        q: search.trim() || undefined,
        tech_status: techStatus || undefined,
        season_id: seasonId ? Number(seasonId) : undefined,
        direction_id: directionId ? Number(directionId) : undefined,
        source: source || undefined,
        submitted_from: submittedFrom || undefined,
        submitted_to: submittedTo || undefined,
        has_remarks: hasRemarks === '' ? undefined : hasRemarks === 'true',
        limit: 300,
      };
      setRows(await adminApi.applications(query));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить список заявок.');
    } finally {
      setLoading(false);
    }
  }, [search, techStatus, seasonId, directionId, source, submittedFrom, submittedTo, hasRemarks]);

  useEffect(() => {
    void load();
  }, [load]);

  // Справочники для фильтров: сезоны и направления.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [seasonRows, directionRows] = await Promise.all([
          adminApi.seasons(),
          adminApi.resourceList<{ id: number; title: string }>('directions', { limit: 100 }),
        ]);
        if (!active) return;
        setSeasons(seasonRows.map((row) => ({ id: row.id, title: row.title })));
        setDirections(directionRows.map((row) => ({ id: row.id, title: row.title })));
      } catch {
        // Справочники не критичны: без них фильтры просто остаются пустыми.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function toggleRow(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkPreview(null);
  }

  function toggleAll() {
    setSelected((current) => (current.size === rows.length ? new Set() : new Set(rows.map((row) => row.id))));
    setBulkPreview(null);
  }

  /** Предпросмотр: сервер отвечает, что именно изменится (ТЗ 07, п. 3.3). */
  async function loadBulkPreview() {
    if (selected.size === 0) return;
    if (bulkStatus === 'rejected' && bulkReason.trim().length < 5) {
      setError('При отклонении укажите причину: команда увидит её в личном кабинете.');
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      const result = await adminApi.bulkApplications({
        ids: [...selected],
        patch: {
          tech_status: bulkStatus,
          ...(bulkStatus === 'rejected' ? { tech_rejection_reason: bulkReason.trim() } : {}),
        },
        dry_run: true,
      });
      setBulkPreview({ affected: result.affected, rows: result.preview });
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось подготовить предпросмотр.');
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmBulk() {
    if (!bulkPreview || selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const result = await adminApi.bulkApplications({
        ids: [...selected],
        patch: {
          tech_status: bulkStatus,
          ...(bulkStatus === 'rejected' ? { tech_rejection_reason: bulkReason.trim() } : {}),
        },
      });
      setBulkPreview(null);
      setSelected(new Set());
      setBulkReason('');
      await load();
      setError(null);
      window.alert(`Обработано заявок: ${result.affected}.`);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Массовая проверка не выполнена.');
    } finally {
      setBulkBusy(false);
    }
  }

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
            label="Поиск по команде, организации или ФИО участника"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Например, Приёмов"
          />
          <SelectField
            id="applications-status"
            label="Статус технической проверки"
            value={techStatus}
            onChange={(event) => setTechStatus(event.target.value)}
            placeholder="Все статусы"
            options={Object.entries(TECH_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
          />
          <SelectField
            id="applications-season"
            label="Сезон"
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
            placeholder="Все сезоны"
            options={seasons.map((season) => ({ value: String(season.id), title: season.title }))}
          />
          <SelectField
            id="applications-direction"
            label="Направление"
            value={directionId}
            onChange={(event) => setDirectionId(event.target.value)}
            placeholder="Все направления"
            options={directions.map((direction) => ({ value: String(direction.id), title: direction.title }))}
          />
          <SelectField
            id="applications-source"
            label="Источник"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Любой"
            options={[
              { value: 'site', title: 'Форма на сайте' },
              { value: 'import', title: 'Перенос из архива' },
            ]}
          />
          <TextField
            id="applications-from"
            label="Подана с"
            type="date"
            value={submittedFrom}
            onChange={(event) => setSubmittedFrom(event.target.value)}
          />
          <TextField
            id="applications-to"
            label="Подана по"
            type="date"
            value={submittedTo}
            onChange={(event) => setSubmittedTo(event.target.value)}
          />
          <SelectField
            id="applications-remarks"
            label="Замечания"
            value={hasRemarks}
            onChange={(event) => setHasRemarks(event.target.value)}
            placeholder="Не важно"
            options={[
              { value: 'true', title: 'Есть замечания' },
              { value: 'false', title: 'Без замечаний' },
            ]}
          />
          <div className="flex items-end">
            <Button type="submit" loading={loading}>
              Найти
            </Button>
          </div>
        </form>
      </SectionCard>

      {selected.size > 0 ? (
        <SectionCard
          title={`Массовая техническая проверка: выбрано ${selected.size}`}
          description="Сначала предпросмотр — что именно изменится, затем подтверждение. Каждое действие попадает в журнал."
          actions={
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" loading={bulkBusy} onClick={() => void loadBulkPreview()}>
                Предпросмотр
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setSelected(new Set());
                  setBulkPreview(null);
                }}
              >
                Снять выделение
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="md:w-72">
              <SelectField
                id="bulk-tech-status"
                label="Новое состояние технической проверки"
                value={bulkStatus}
                onChange={(event) => {
                  setBulkStatus(event.target.value);
                  setBulkPreview(null);
                }}
                options={Object.entries(TECH_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
              />
            </div>
            {bulkStatus === 'rejected' ? (
              <div className="md:flex-1">
                <TextField
                  id="bulk-reason"
                  label="Причина отклонения"
                  required
                  value={bulkReason}
                  onChange={(event) => setBulkReason(event.target.value)}
                  hint="Команда увидит причину в личном кабинете."
                />
              </div>
            ) : null}
          </div>

          {bulkPreview ? (
            <div className="mt-5 border border-border p-4">
              <p className="font-medium">Будет обработано заявок: {bulkPreview.affected}</p>
              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th scope="col" className="py-2 pr-4">№</th>
                      <th scope="col" className="py-2 pr-4">Команда</th>
                      <th scope="col" className="py-2 pr-4">Было</th>
                      <th scope="col" className="py-2">Станет</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreview.rows.map((row) => (
                      <tr key={String(row.id)} className="border-b border-border">
                        <td className="py-2 pr-4 font-mono">{String(row.public_number ?? row.id)}</td>
                        <td className="py-2 pr-4">{String(row.team_name ?? '—')}</td>
                        <td className="py-2 pr-4">
                          {TECH_STATUS_TITLES[String(row.tech_status_before ?? '')] ?? String(row.tech_status_before ?? '—')}
                        </td>
                        <td className="py-2">
                          {TECH_STATUS_TITLES[String(row.tech_status_after ?? '')] ?? String(row.tech_status_after ?? '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-3 flex flex-col gap-2 text-sm md:hidden">
                {bulkPreview.rows.map((row) => (
                  <li key={`card-${String(row.id)}`} className="border border-border p-3">
                    <p className="font-mono">{String(row.public_number ?? row.id)}</p>
                    <p>{String(row.team_name ?? '—')}</p>
                    <p className="text-muted">
                      {TECH_STATUS_TITLES[String(row.tech_status_before ?? '')] ?? '—'} →{' '}
                      {TECH_STATUS_TITLES[String(row.tech_status_after ?? '')] ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" loading={bulkBusy} onClick={() => void confirmBulk()}>
                  Применить к {bulkPreview.affected} заявкам
                </Button>
                <Button type="button" variant="quiet" onClick={() => setBulkPreview(null)}>
                  Отменить
                </Button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      ) : null}

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
                  <th scope="col" className="py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все заявки в списке"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={toggleAll}
                      className="h-4 w-4"
                    />
                  </th>
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
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать заявку ${row.team_name}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="h-4 w-4"
                      />
                    </td>
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
                  <label className="mb-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      className="h-4 w-4"
                    />
                    <span className="text-muted">Выбрать для массовой проверки</span>
                  </label>
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
