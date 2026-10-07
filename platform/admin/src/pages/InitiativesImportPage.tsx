import { useState } from 'react';
import { AdminApiError, adminApi } from '@shared/index';
import { Alert, Button, PageHeader, SectionCard } from '@shared/index';

// Массовый импорт архива законопроектов (ТЗ 07, п. 2.14а).
//
// Импорт в два шага: файл читается и показывается как таблица с построчными
// замечаниями, и только потом строки записываются. Оргкомитет видит результат до
// того, как данные попадут в архив: это важно, потому что выгрузки прошлых
// сезонов делаются вручную и содержат опечатки.
//
// Распознаются CSV (разделитель ; или ,) и XLSX. Импортированные инициативы
// создаются неопубликованными — решение о публикации принимает Оргкомитет.

interface PreviewRow {
  row: number;
  values: Record<string, unknown>;
  errors: string[];
  is_duplicate: boolean;
}

interface Preview {
  format: string;
  file_name: string;
  headers: string[];
  total: number;
  ready: number;
  blocked: number;
  rows: PreviewRow[];
}

const FIELD_TITLES: Record<string, string> = {
  title: 'Название',
  team_name: 'Команда',
  archive_year: 'Год',
  act_level: 'Уровень акта',
  result_place: 'Место',
  nomination: 'Номинация',
  annotation: 'Аннотация',
  proposed_initiator: 'Субъект инициативы',
  direction_id: 'Направление',
};

export function InitiativesImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function check() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      setPreview(await adminApi.previewInitiativesImport(file));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось прочитать файл.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    const rows = preview.rows
      .filter((row) => row.values.title)
      .map((row) => ({ row: row.row, values: row.values }));
    if (rows.length === 0) {
      setError('В файле нет строк с названием инициативы.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.applyInitiativesImport(rows);
      setNotice(
        `Импорт завершён: создано ${result.created}, обновлено ${result.updated}` +
          (result.skipped.length > 0 ? `, пропущено строк: ${result.skipped.length}` : '') +
          `. ${result.note}`
      );
      setPreview(null);
      setFile(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось записать строки импорта.');
    } finally {
      setBusy(false);
    }
  }

  const fields = ['title', 'team_name', 'archive_year', 'act_level', 'result_place', 'nomination', 'annotation', 'proposed_initiator'];

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Контент сайта"
        title="Импорт архива"
        lead="Загрузка выгрузки прошлых сезонов в CSV или XLSX. Сначала предпросмотр с замечаниями, затем запись в архив."
      />

      {error ? <Alert tone="danger" title="Не удалось выполнить">{error}</Alert> : null}
      {notice ? <Alert tone="success" title="Готово">{notice}</Alert> : null}

      <SectionCard
        title="Файл"
        description="Заголовки распознаются по-русски и по-английски: «Название», «Команда», «Год», «Уровень акта», «Место», «Номинация», «Аннотация», «Направление»."
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="md:w-96">
            <label className="mono-label text-muted" htmlFor="import-file">
              Файл CSV или XLSX
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-2 block w-full border border-border-strong bg-raised px-3 py-2 text-sm"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setNotice(null);
              }}
            />
          </div>
          <Button type="button" loading={busy} disabled={file === null} onClick={() => void check()}>
            Проверить файл
          </Button>
        </div>
      </SectionCard>

      {preview ? (
        <SectionCard
          title="Предпросмотр"
          description={`Файл ${preview.file_name} (${preview.format.toUpperCase()}): строк ${preview.total}, готово к импорту ${preview.ready}, с замечаниями ${preview.blocked}.`}
          actions={
            <div className="flex flex-wrap gap-3">
              <Button type="button" loading={busy} disabled={preview.ready === 0} onClick={() => void apply()}>
                Импортировать
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
              >
                Отменить
              </Button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <caption className="sr-only-text">Предпросмотр импорта архива</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">
                    Строка
                  </th>
                  {fields.map((field) => (
                    <th key={field} scope="col" className="py-2 pr-4">
                      {FIELD_TITLES[field] ?? field}
                    </th>
                  ))}
                  <th scope="col" className="py-2">
                    Замечания
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row} className="border-b border-border align-top">
                    <td className="py-2 pr-4 font-mono">{row.row}</td>
                    {fields.map((field) => (
                      <td key={`${row.row}-${field}`} className="py-2 pr-4">
                        {row.values[field] === null || row.values[field] === undefined || row.values[field] === ''
                          ? '—'
                          : String(row.values[field])}
                      </td>
                    ))}
                    <td className={`py-2 ${row.errors.length > 0 ? 'text-danger' : 'text-muted'}`}>
                      {row.errors.length > 0 ? row.errors.join('; ') : 'готово'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-muted">
            Импортированные работы создаются неопубликованными: решение о публикации принимает Оргкомитет, а согласие
            авторов по Приложению № 12 отмечается отдельно.
          </p>
        </SectionCard>
      ) : null}
    </main>
  );
}
