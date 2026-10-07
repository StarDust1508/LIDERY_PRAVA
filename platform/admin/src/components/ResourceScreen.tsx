import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminApiError, adminApi, formatMoscowHuman } from '@shared/index';
import { Alert, Button, SectionCard, SelectField, TextAreaField, TextField } from '@shared/index';
import type { ResourceConfig, ResourceField } from '../lib/resources';

// Универсальный экран раздела админки (ТЗ 07, п. 1.4 и 3).
//
// Один экран обслуживает все справочники и разделы контента: список с фильтрами
// и поиском, создание, правка, удаление через подтверждение, выгрузка CSV по
// текущей выборке. Раздел описывается конфигурацией (lib/resources.ts), поэтому
// новый раздел не требует ни новой разметки, ни нового набора проверок.
//
// Требования, которые здесь выполняются для всех разделов сразу:
//   • пустое состояние объясняет, что сделать (п. 1.6);
//   • опасные действия отделены и подтверждаются (п. 3.2);
//   • ошибка объясняет, что делать (п. 3.5);
//   • таблицы не «прыгают»: фильтры сохраняются в адресной строке (п. 3.6);
//   • на узких экранах строки превращаются в карточки.

type Row = Record<string, unknown>;

function displayValue(row: Row, field: ResourceField): string {
  const value = row[field.name];
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'bool') return value === true ? 'да' : 'нет';
  if (field.type === 'timestamptz') return formatMoscowHuman(String(value));
  if (field.type === 'date') return formatMoscowHuman(`${String(value)}T00:00:00+03:00`).replace(/,.*/, '');
  if (field.type === 'json') {
    if (Array.isArray(value)) return `${value.length} элем.`;
    return typeof value === 'object' ? 'заполнено' : String(value);
  }
  if (field.type === 'select') {
    const option = field.options?.find((item) => String(item.value) === String(value));
    if (option) return option.title;
  }
  return String(value).length > 160 ? `${String(value).slice(0, 160)}…` : String(value);
}

function toInputValue(row: Row, field: ResourceField): string {
  const value = row[field.name];
  if (value === null || value === undefined) return '';
  if (field.type === 'timestamptz') {
    // datetime-local ждёт значение без часового пояса: показываем московское время.
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
    return parts.replace(' ', 'T');
  }
  if (field.type === 'date') return String(value).slice(0, 10);
  return String(value);
}

function fromInputValue(field: ResourceField, value: string): unknown {
  if (field.type === 'bool') return value === 'true';
  if (value === '') return null;
  if (field.type === 'int' || field.type === 'numeric') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (field.type === 'timestamptz') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (field.type === 'json') {
    // Пустая строка означает «структуры нет»: сервер получит NULL.
    if (value.trim() === '') return null;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Поле «${field.title}»: значение должно быть корректным JSON.`);
    }
  }
  return value;
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ResourceField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === 'bool') {
    return (
      <div className="flex items-start gap-3">
        <input
          id={`field-${field.name}`}
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          className="mt-1 h-5 w-5"
        />
        <label htmlFor={`field-${field.name}`} className="text-sm">
          {field.title}
          {field.hint ? <span className="mt-1 block text-muted">{field.hint}</span> : null}
        </label>
      </div>
    );
  }
  if (field.type === 'json') {
    return (
      <TextAreaField
        id={`field-${field.name}`}
        label={field.title}
        value={value}
        hint={field.hint ?? 'Формат JSON. Например: [{"title":"Слайды","url":"https://…"}]'}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <TextAreaField
        id={`field-${field.name}`}
        label={field.title}
        value={value}
        hint={field.hint}
        maxLength={field.maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === 'select' && field.options && field.options.length > 0) {
    return (
      <SelectField
        id={`field-${field.name}`}
        label={field.title}
        value={value}
        hint={field.hint}
        options={field.options.map((option) => ({ value: String(option.value), title: option.title }))}
        placeholder="Не задано"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const inputType =
    field.type === 'int' || field.type === 'numeric'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'timestamptz'
          ? 'datetime-local'
          : 'text';
  return (
    <TextField
      id={`field-${field.name}`}
      label={field.title}
      type={inputType}
      value={value}
      hint={field.hint ?? (field.type === 'timestamptz' ? 'Время указывается по Москве.' : undefined)}
      maxLength={field.maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ResourceScreen({ config }: { config: ResourceConfig }) {
  const readOnly = config.readOnly === true;
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; values: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  // Постраничность и сортировка (ТЗ 07, п. 1.4): по 50 записей на страницу.
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' } | null>(null);
  const [total, setTotal] = useState(0);
  const perPage = 50;

  const listFields = useMemo(
    () => config.fields.filter((field) => field.inList).slice(0, 6),
    [config.fields]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(filters)) {
        if (value !== '') params[key] = value;
      }
      if (search.trim() !== '') params.q = search.trim();
      params.page = page;
      params.perPage = perPage;
      if (sort) {
        params.sort_by = sort.by;
        params.sort_dir = sort.dir;
      }
      const { data, meta } = await adminApi.resourceListPage<Row>(config.key, params);
      setRows(data);
      setTotal(meta?.total ?? data.length);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить список.');
    } finally {
      setLoading(false);
    }
  }, [config.key, filters, search, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // Смена фильтра, поиска или сортировки возвращает на первую страницу: иначе
  // можно оказаться на несуществующей странице отфильтрованного списка.
  useEffect(() => {
    setPage(1);
  }, [filters, search, sort]);

  const pages = Math.max(1, Math.ceil(total / perPage));

  /** Переключает сортировку колонки: asc → desc → по умолчанию раздела. */
  function toggleSort(column: string) {
    setSort((current) => {
      if (!current || current.by !== column) return { by: column, dir: 'asc' };
      if (current.dir === 'asc') return { by: column, dir: 'desc' };
      return null;
    });
  }

  function startCreate() {
    const values: Record<string, string> = {};
    for (const field of config.fields) {
      values[field.name] = field.type === 'bool' ? 'false' : '';
    }
    setEditing({ id: null, values });
    setNotice(null);
    setError(null);
  }

  function startEdit(row: Row) {
    const values: Record<string, string> = {};
    for (const field of config.fields) {
      values[field.name] = field.type === 'bool' ? String(row[field.name] === true) : toInputValue(row, field);
    }
    setEditing({ id: Number(row.id), values });
    setNotice(null);
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of config.fields) {
        try {
          payload[field.name] = fromInputValue(field, editing.values[field.name] ?? '');
        } catch (parseError) {
          setError((parseError as Error).message);
          return;
        }
      }
      if (editing.id === null) {
        await adminApi.resourceCreate(config.key, payload);
        setNotice('Запись создана.');
      } else {
        await adminApi.resourceUpdate(config.key, editing.id, payload);
        setNotice('Изменения сохранены.');
      }
      setEditing(null);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось сохранить запись.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Row) {
    setBusy(true);
    setError(null);
    try {
      await adminApi.resourceDelete(config.key, Number(row.id));
      setNotice('Запись удалена.');
      setConfirmDelete(null);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось удалить запись.');
    } finally {
      setBusy(false);
    }
  }

  /** Выгрузка текущей выборки: те же фильтры, что на экране (ТЗ 07, п. 1.8). */
  function exportCsv() {
    const header = config.fields.map((field) => field.title);
    const lines = [header.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')];
    for (const row of rows) {
      lines.push(
        config.fields
          .map((field) => `"${displayValue(row, field).replace(/"/g, '""')}"`)
          .join(';')
      );
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.key}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="mono-label text-muted">Раздел админ-панели</p>
        <h1 className="mt-2 text-h2 font-semibold tracking-[var(--tr-heading)]">{config.title}</h1>
        <p className="mt-2 max-w-measure text-muted">{config.description}</p>
        {config.adminOnly ? (
          <p className="mt-2 text-sm text-muted">
            Раздел доступен только роли «администратор»: изменения затрагивают правила конкурса и права доступа.
          </p>
        ) : null}
      </header>

      {notice ? <Alert tone="success" title="Готово">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="Не удалось выполнить">{error}</Alert> : null}

      {editing ? (
        <SectionCard
          title={editing.id === null ? 'Новая запись' : `Изменение записи № ${editing.id}`}
          description="Поля с пустым значением не заполняются — оставьте их пустыми, если сведения не нужны."
          actions={
            <div className="flex flex-wrap gap-3">
              <Button type="button" loading={busy} onClick={() => void save()}>
                Сохранить
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Отменить
              </Button>
            </div>
          }
        >
          <div className="grid gap-5 md:grid-cols-2">
            {config.fields.map((field) => (
              <div key={field.name} className={field.type === 'textarea' ? 'md:col-span-2' : undefined}>
                <FieldControl
                  field={field}
                  value={editing.values[field.name] ?? ''}
                  onChange={(value) =>
                    setEditing((current) =>
                      current ? { ...current, values: { ...current.values, [field.name]: value } } : current
                    )
                  }
                />
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {confirmDelete ? (
        <Alert tone="danger" title="Удалить запись?">
          <p>
            {String(confirmDelete[listFields[0]?.name ?? 'id'] ?? 'Запись')} будет удалена без возможности
            восстановления. Если запись используется в других разделах (например, в заявках или рейтинге), удаление
            будет отклонено — тогда снимите отметку публикации вместо удаления.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" variant="secondary" loading={busy} onClick={() => void remove(confirmDelete)}>
              Удалить
            </Button>
            <Button type="button" variant="quiet" onClick={() => setConfirmDelete(null)}>
              Оставить
            </Button>
          </div>
        </Alert>
      ) : null}

      <SectionCard
        title="Список"
        description={
          total > perPage
            ? `Показаны записи ${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} из ${total}.`
            : `Записей: ${total}.`
        }
        actions={
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={startCreate}>
              Добавить
            </Button>
            <Button type="button" variant="secondary" disabled={rows.length === 0} onClick={exportCsv}>
              Выгрузить CSV
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end">
          {config.searchable ? (
            <div className="md:w-80">
              <TextField
                id={`${config.key}-search`}
                label="Поиск"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Название или адрес"
              />
            </div>
          ) : null}
          {(config.filters ?? []).map((filter) => (
            <div key={filter.name} className="md:w-64">
              <SelectField
                id={`${config.key}-filter-${filter.name}`}
                label={filter.title}
                value={filters[filter.name] ?? ''}
                options={filter.options.map((option) => ({ value: option.value, title: option.title }))}
                placeholder="Все"
                onChange={(event) => setFilters((current) => ({ ...current, [filter.name]: event.target.value }))}
              />
            </div>
          ))}
        </div>

        {loading ? <p role="status">Загружаем список…</p> : null}
        {!loading && rows.length === 0 ? <p className="text-muted">{config.emptyText}</p> : null}

        {rows.length > 0 ? (
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th scope="col" className="py-2 pr-4">№</th>
                  {listFields.map((field) => (
                    <th key={field.name} scope="col" className="py-2 pr-4">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-left uppercase hover:text-accent"
                        onClick={() => toggleSort(field.name)}
                        title="Сортировать по колонке"
                      >
                        {field.title}
                        <span aria-hidden="true">
                          {sort?.by === field.name ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-b border-border align-top">
                    <td className="py-3 pr-4 font-mono">{String(row.id)}</td>
                    {listFields.map((field) => (
                      <td key={field.name} className="py-3 pr-4">
                        {displayValue(row, field)}
                      </td>
                    ))}
                    <td className="py-3">
                      {readOnly ? (
                        <span className="text-muted">только чтение</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="secondary" onClick={() => startEdit(row)}>
                            Изменить
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="border-danger text-danger"
                            onClick={() => setConfirmDelete(row)}
                          >
                            Удалить
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {total > perPage ? (
          <nav className="mt-4 flex flex-wrap items-center gap-3" aria-label="Постраничный переход">
            <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Назад
            </Button>
            <span className="text-sm text-muted">
              Страница {page} из {pages}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд
            </Button>
          </nav>
        ) : null}

        {rows.length > 0 ? (
          <ul className="flex flex-col gap-4 md:hidden">
            {rows.map((row) => (
              <li key={String(row.id)} className="border border-border p-4">
                <p className="mono-label text-muted">№ {String(row.id)}</p>
                <dl className="mt-2 flex flex-col gap-2 text-sm">
                  {listFields.map((field) => (
                    <div key={field.name}>
                      <dt className="text-muted">{field.title}</dt>
                      <dd>{displayValue(row, field)}</dd>
                    </div>
                  ))}
                </dl>
                {readOnly ? (
                  <p className="mt-3 text-muted">Только чтение и выгрузка.</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => startEdit(row)}>
                      Изменить
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="border-danger text-danger"
                      onClick={() => setConfirmDelete(row)}
                    >
                      Удалить
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>
    </div>
  );
}
