import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AdminApiError,
  type AdminMaterial,
  adminApi,
  formatFileSize,
  formatMoscowHuman,
  MATERIAL_STATUS_TITLES,
  materialTypeTitle,
  pluralize,
} from '@shared/index';
import {
  Alert,
  Button,
  PageHeader,
  SectionCard,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@shared/index';

// Материалы команд: очередь проверки и замечания (ТЗ 07, п. 2.3).
//
// Экран отвечает на один вопрос: что сделать с каждым файлом — принять или
// вернуть на доработку с замечанием и сроком (не более двух рабочих дней,
// п. 7.5 Положения). Массовые операции идут через предпросмотр: сначала
// сервер считает, что именно изменится (п. 3.3), и только потом — запись.
//
// Фильтр по статусу и поиск хранятся в адресной строке (п. 3.6), поэтому
// ссылку на отфильтрованную очередь можно передать коллеге.

/** Статус материала передаётся текстом: цвет не единственный носитель смысла. */
function materialBadgeStatus(status: string): string {
  if (status === 'accepted') return 'allowed';
  if (status === 'uploaded') return 'draft';
  return 'tech_rejected';
}

/** Ошибка объясняет, что делать (п. 3.5). */
function explain(caught: unknown, fallback: string): string {
  if (caught instanceof AdminApiError) {
    if (caught.status === 0) return `${caught.message} Проверьте соединение и повторите запрос.`;
    if (caught.status === 401 || caught.status === 403) {
      return `${caught.message} Возможно, сеанс завершён — войдите в панель заново.`;
    }
    return caught.message;
  }
  return fallback;
}

type PreviewRow = Record<string, unknown>;

/**
 * Поле «Срок досдачи» показывает московское время: сроки конкурса заданы по
 * МСК (п. 6.2 Положения), а `datetime-local` не хранит часовой пояс.
 */
function toMoscowInput(value: string | null): string {
  if (value === null) return '';
  const date = new Date(value);
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

/** Обратное преобразование: значение поля считается московским временем. */
function fromMoscowInput(value: string): string | null {
  if (value === '') return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface BulkPreview {
  action: 'accept' | 'request_fix';
  comment: string | null;
  affected: number;
  rows: PreviewRow[];
}

const BULK_ACTIONS = {
  accept: { title: 'Принять выбранные', confirmed: 'Подтвердить приёмку', done: 'принято' },
  request_fix: { title: 'Вернуть выбранные на доработку', confirmed: 'Подтвердить возврат', done: 'возвращено на доработку' },
} as const;

export function MaterialsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const query = searchParams.get('q') ?? '';
  const deadlineFilter = searchParams.get('deadline') ?? '';

  const [searchDraft, setSearchDraft] = useState(query);
  const [rows, setRows] = useState<AdminMaterial[]>([]);
  const [teamNames, setTeamNames] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkComment, setBulkComment] = useState('');
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [fixDraft, setFixDraft] = useState<Record<number, { comment: string; deadline: string }>>({});
  const [openFix, setOpenFix] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Названия команд приходят отдельным справочником: в строке материала
      // сервер отдаёт только team_id. Если справочник недоступен, показываем
      // номер команды, а не пустое место.
      const [materials, teams] = await Promise.all([
        adminApi.materials(status === '' ? {} : { status }),
        adminApi.teams().catch(() => []),
      ]);
      setRows(materials);
      setTeamNames(new Map(teams.map((team) => [team.id, team.name])));
      setSelected(new Set());
      setPreview(null);
      setOpenFix(null);
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить список конкурсных материалов.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setParam('q', searchDraft.trim());
  }

  /** Поиск по команде и файлу и фильтр по сроку идут по загруженной выборке. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle !== '') {
        const team = (teamNames.get(row.team_id) ?? '').toLowerCase();
        const file = (row.file_name ?? row.external_url ?? '').toLowerCase();
        if (!team.includes(needle) && !file.includes(needle)) return false;
      }
      if (deadlineFilter !== '') {
        if (row.status !== 'needs_fix' || row.fix_deadline === null) return false;
        const time = new Date(row.fix_deadline).getTime();
        if (Number.isNaN(time)) return false;
        const now = Date.now();
        if (deadlineFilter === 'overdue' && time >= now) return false;
        if (deadlineFilter === 'urgent' && (time < now || time > now + 2 * 24 * 60 * 60 * 1000)) return false;
      }
      return true;
    });
  }, [rows, query, teamNames, deadlineFilter]);

  const allSelected = visible.length > 0 && visible.every((row) => selected.has(row.id));

  function toggleRow(id: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visible) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  function teamName(teamId: number): string {
    return teamNames.get(teamId) ?? `Команда № ${teamId}`;
  }

  function fixFor(material: AdminMaterial): { comment: string; deadline: string } {
    return (
      fixDraft[material.id] ?? {
        comment: material.reviewer_comment ?? '',
        deadline: toMoscowInput(material.fix_deadline),
      }
    );
  }

  async function openFile(material: AdminMaterial) {
    if (!material.media_id) return;
    setBusyId(material.id);
    setError(null);
    try {
      const blob = await adminApi.materialFile(material.media_id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(explain(caught, `Не удалось открыть файл «${material.file_name ?? 'без имени'}».`));
    } finally {
      setBusyId(null);
    }
  }

  async function acceptOne(material: AdminMaterial) {
    setBusyId(material.id);
    setError(null);
    setNotice(null);
    try {
      // Сервер читает замечание из поля comment, обёртка adminApi.reviewMaterial
      // объявляет reviewer_comment: передаём оба ключа, чтобы замечание не потерялось.
      const payload = { status: 'accepted', reviewer_comment: null, comment: null, fix_deadline: null };
      await adminApi.reviewMaterial(material.id, payload);
      setNotice(`Материал «${materialTypeTitle(material.type)}» принят.`);
      await load();
    } catch (caught) {
      setError(explain(caught, 'Не удалось принять материал.'));
    } finally {
      setBusyId(null);
    }
  }

  async function requestFix(material: AdminMaterial) {
    const draft = fixFor(material);
    const comment = draft.comment.trim();
    if (comment === '') return;
    setBusyId(material.id);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        status: 'needs_fix',
        reviewer_comment: comment,
        comment,
        // Пустое значение — сервер сам поставит срок: два рабочих дня.
        fix_deadline: fromMoscowInput(draft.deadline),
      };
      await adminApi.reviewMaterial(material.id, payload);
      setNotice(`Материал «${materialTypeTitle(material.type)}» возвращён на доработку: команда увидит замечание.`);
      await load();
    } catch (caught) {
      setError(explain(caught, 'Не удалось вернуть материал на доработку.'));
    } finally {
      setBusyId(null);
    }
  }

  async function loadPreview(action: 'accept' | 'request_fix') {
    if (selected.size === 0) return;
    const comment = bulkComment.trim();
    if (action === 'request_fix' && comment === '') return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.bulkMaterials({
        ids: [...selected],
        action,
        comment: comment === '' ? null : comment,
        dry_run: true,
      });
      setPreview({ action, comment: comment === '' ? null : comment, affected: result.affected, rows: result.preview });
    } catch (caught) {
      setError(explain(caught, 'Не удалось подготовить предпросмотр массовой операции.'));
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmBulk() {
    if (!preview) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.bulkMaterials({
        ids: [...selected],
        action: preview.action,
        comment: preview.comment,
        dry_run: false,
      });
      setNotice(
        `Массовая операция выполнена: ${pluralize(result.affected, ['материал', 'материала', 'материалов'])} ${BULK_ACTIONS[preview.action].done}.`
      );
      setPreview(null);
      setBulkComment('');
      await load();
    } catch (caught) {
      setError(explain(caught, 'Массовая операция не выполнена. Повторите предпросмотр и подтвердите заново.'));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Техническая проверка"
        title="Конкурсные материалы"
        lead="Очередь проверки: файлы и ссылки команд. Замечание обязательно — команда увидит его в личном кабинете вместе со сроком досдачи (не более двух рабочих дней)."
        aside={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            Обновить
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" title="Не удалось выполнить">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Готово">
          {notice}
        </Alert>
      ) : null}

      <SectionCard
        title="Фильтры"
        description={`Материалов в выборке: ${rows.length}; показано: ${visible.length}; выбрано: ${selected.size}.`}
      >
        <form className="grid gap-4 md:grid-cols-[2fr,1fr,1fr,auto]" onSubmit={applySearch}>
          <TextField
            id="materials-search"
            label="Поиск по команде или файлу"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Название команды или имя файла"
            hint="Поиск идёт по загруженной выборке (до 500 записей)."
          />
          <SelectField
            id="materials-status"
            label="Статус материала"
            value={status}
            options={[
              { value: 'uploaded', title: MATERIAL_STATUS_TITLES['uploaded'] ?? 'Загружен' },
              { value: 'accepted', title: MATERIAL_STATUS_TITLES['accepted'] ?? 'Принят' },
              { value: 'needs_fix', title: MATERIAL_STATUS_TITLES['needs_fix'] ?? 'Требует исправления' },
              { value: 'rejected', title: MATERIAL_STATUS_TITLES['rejected'] ?? 'Отклонён' },
            ]}
            placeholder="Все статусы"
            onChange={(event) => setParam('status', event.target.value)}
          />
          <SelectField
            id="materials-deadline"
            label="Срок досдачи"
            value={deadlineFilter}
            options={[
              { value: 'urgent', title: 'Истекает в течение двух суток' },
              { value: 'overdue', title: 'Просрочен' },
            ]}
            placeholder="Любой срок"
            hint="Считается в панели по сроку, который сервер поставил при возврате."
            onChange={(event) => setParam('deadline', event.target.value)}
          />
          <div className="flex items-end">
            <Button type="submit" loading={loading}>
              Найти
            </Button>
          </div>
        </form>
        {query !== '' || status !== '' || deadlineFilter !== '' ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setSearchDraft('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Сбросить фильтры
            </Button>
          </div>
        ) : null}
      </SectionCard>

      {selected.size > 0 ? (
        <SectionCard
          title="Массовая операция по выбранным материалам"
          description={`Выбрано: ${pluralize(selected.size, ['материал', 'материала', 'материалов'])}. Операция выполняется только после предпросмотра: сначала панель покажет, что именно изменится.`}
          actions={
            <Button type="button" variant="quiet" onClick={() => setSelected(new Set())}>
              Снять выбор
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <TextAreaField
              id="materials-bulk-comment"
              label="Замечание для выбранных материалов"
              value={bulkComment}
              maxLength={3000}
              onChange={(event) => setBulkComment(event.target.value)}
              hint="Обязательно при возврате на доработку: команда увидит текст замечания. При приёмке поле не используется."
            />
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={bulkBusy || selected.size === 0}
                title={selected.size === 0 ? 'Отметьте хотя бы один материал' : undefined}
                onClick={() => void loadPreview('accept')}
              >
                {BULK_ACTIONS.accept.title}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={bulkBusy || selected.size === 0 || bulkComment.trim() === ''}
                title={
                  bulkComment.trim() === ''
                    ? 'Укажите замечание: команда увидит его в личном кабинете'
                    : selected.size === 0
                      ? 'Отметьте хотя бы один материал'
                      : undefined
                }
                onClick={() => void loadPreview('request_fix')}
              >
                {BULK_ACTIONS.request_fix.title}
              </Button>
            </div>
            {bulkComment.trim() === '' ? (
              <p className="text-sm text-muted">
                Пока замечание не заполнено, возврат на доработку недоступен: без текста команда не узнает, что
                исправить.
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {preview ? (
        <SectionCard
          title="Предпросмотр: что изменится"
          description={`Затронуто записей: ${preview.affected}. Проверьте список и подтвердите операцию — до подтверждения ничего не изменено.`}
          actions={
            <div className="flex flex-wrap gap-3">
              <Button type="button" loading={bulkBusy} onClick={() => void confirmBulk()}>
                {BULK_ACTIONS[preview.action].confirmed}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
                Отменить
              </Button>
            </div>
          }
        >
          {preview.action === 'request_fix' && preview.comment ? (
            <p className="mb-4 text-sm">
              <span className="mono-label text-muted">Замечание командам</span>
              <br />
              {preview.comment}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only-text">Предпросмотр массовой операции с материалами</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">
                    Материал
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Команда
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Тип
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Было
                  </th>
                  <th scope="col" className="py-2">
                    Станет
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={String(row.id)} className="border-b border-border">
                    <td className="py-2 pr-4 font-mono">№ {String(row.id)}</td>
                    <td className="py-2 pr-4">{String(row.team_name ?? '—')}</td>
                    <td className="py-2 pr-4">{materialTypeTitle(String(row.type ?? ''))}</td>
                    <td className="py-2 pr-4">
                      {MATERIAL_STATUS_TITLES[String(row.status_before ?? '')] ?? String(row.status_before ?? '—')}
                    </td>
                    <td className="py-2">
                      {MATERIAL_STATUS_TITLES[String(row.status_after ?? '')] ?? String(row.status_after ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Очередь проверки"
        description="Отметьте материалы для массовой операции или примите решение по каждому. Ссылка на команду ведёт в карточку заявки: там же оформляется окончательное отклонение материала."
      >
        {loading && rows.length === 0 ? <p role="status">Загружаем конкурсные материалы…</p> : null}

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-muted">
            {status === ''
              ? 'Конкурсные материалы ещё не загружены. Они появятся здесь после того, как команды заполнят комплект в личном кабинете.'
              : 'Материалов с таким статусом нет. Выберите другой статус или сбросьте фильтры.'}
          </p>
        ) : null}

        {rows.length > 0 && visible.length === 0 ? (
          <p className="text-sm text-muted">
            По этим условиям материалов нет. Измените запрос или сбросьте фильтры.
          </p>
        ) : null}

        {visible.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <caption className="sr-only-text">Очередь проверки конкурсных материалов</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={allSelected}
                        aria-label="Отметить все материалы в выборке"
                        onChange={(event) => toggleAll(event.target.checked)}
                      />
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Команда
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Тип материала
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Файл
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Статус
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Замечание
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Срок досдачи
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Загружен
                    </th>
                    <th scope="col" className="py-2">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((material) => {
                    const draft = fixFor(material);
                    const typeTitle = materialTypeTitle(material.type);
                    const deadlinePassed =
                      material.fix_deadline !== null && new Date(material.fix_deadline).getTime() < Date.now();
                    return (
                      <tr key={material.id} className="border-b border-border align-top">
                        <td className="py-3 pr-3">
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={selected.has(material.id)}
                            aria-label={`Выбрать материал «${typeTitle}» команды ${teamName(material.team_id)}`}
                            onChange={(event) => toggleRow(material.id, event.target.checked)}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <Link
                            to={`/applications/${material.application_id}`}
                            className="text-accent underline underline-offset-2"
                          >
                            {teamName(material.team_id)}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">
                          {typeTitle}
                          <span className="block text-muted">Версия {material.version}</span>
                        </td>
                        <td className="py-3 pr-4">
                          {material.file_name ? (
                            <>
                              {material.file_name}
                              <span className="block text-muted">
                                {material.file_type ?? 'тип не определён'}
                                {material.file_size !== null ? ` · ${formatFileSize(material.file_size)}` : ''}
                              </span>
                            </>
                          ) : material.external_url ? (
                            <a
                              href={material.external_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent underline underline-offset-2"
                            >
                              Ссылка на материал
                            </a>
                          ) : (
                            <span className="text-muted">Файл не загружен</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <StatusBadge
                            status={materialBadgeStatus(material.status)}
                            title={MATERIAL_STATUS_TITLES[material.status] ?? material.status}
                          />
                        </td>
                        <td className="py-3 pr-4 max-w-measure break-words">
                          {material.reviewer_comment ?? '—'}
                        </td>
                        <td className="py-3 pr-4">
                          {material.fix_deadline ? (
                            <>
                              {formatMoscowHuman(material.fix_deadline)}
                              {deadlinePassed ? <span className="block text-danger">срок истёк</span> : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 pr-4">{formatMoscowHuman(material.created_at)}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              loading={busyId === material.id}
                              disabled={material.media_id === null}
                              title={
                                material.media_id === null
                                  ? 'Файл не загружен: команда передала материал ссылкой'
                                  : undefined
                              }
                              onClick={() => void openFile(material)}
                            >
                              Открыть файл
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              loading={busyId === material.id}
                              onClick={() => void acceptOne(material)}
                            >
                              Принять
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setOpenFix(openFix === material.id ? null : material.id);
                                setFixDraft((current) => ({ ...current, [material.id]: draft }));
                              }}
                              aria-expanded={openFix === material.id}
                            >
                              Вернуть на доработку
                            </Button>
                          </div>
                          {openFix === material.id ? (
                            <div className="mt-4 flex flex-col gap-4 border border-border p-4">
                              <TextAreaField
                                id={`material-comment-${material.id}`}
                                label="Замечание команде"
                                value={draft.comment}
                                maxLength={3000}
                                required
                                onChange={(event) =>
                                  setFixDraft((current) => ({
                                    ...current,
                                    [material.id]: { ...draft, comment: event.target.value },
                                  }))
                                }
                                hint="Что именно исправить: текст увидит команда в личном кабинете."
                              />
                              <TextField
                                id={`material-deadline-${material.id}`}
                                label="Срок досдачи"
                                type="datetime-local"
                                value={draft.deadline}
                                onChange={(event) =>
                                  setFixDraft((current) => ({
                                    ...current,
                                    [material.id]: { ...draft, deadline: event.target.value },
                                  }))
                                }
                                hint="Оставьте пустым — сервер поставит срок сам: два рабочих дня. Время указывается по Москве."
                              />
                              <div className="flex flex-wrap gap-3">
                                <Button
                                  type="button"
                                  loading={busyId === material.id}
                                  disabled={draft.comment.trim() === ''}
                                  title={
                                    draft.comment.trim() === ''
                                      ? 'Без замечания возврат на доработку невозможен'
                                      : undefined
                                  }
                                  onClick={() => void requestFix(material)}
                                >
                                  Сохранить замечание
                                </Button>
                                <Button type="button" variant="quiet" onClick={() => setOpenFix(null)}>
                                  Отменить
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* На узких экранах таблица превращается в карточки (ТЗ 08, п. 3.6). */}
            <ul className="flex flex-col gap-4 md:hidden">
              <li className="flex items-center gap-3 border border-border p-4 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={allSelected}
                  aria-label="Отметить все материалы в выборке"
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                <span>Отметить все материалы в выборке</span>
              </li>
              {visible.map((material) => {
                const draft = fixFor(material);
                const typeTitle = materialTypeTitle(material.type);
                return (
                  <li key={`card-${material.id}`} className="border border-border p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/applications/${material.application_id}`}
                          className="text-accent underline underline-offset-2"
                        >
                          {teamName(material.team_id)}
                        </Link>
                        <p className="mt-1">{typeTitle}</p>
                      </div>
                      <StatusBadge
                        status={materialBadgeStatus(material.status)}
                        title={MATERIAL_STATUS_TITLES[material.status] ?? material.status}
                      />
                    </div>
                    <dl className="mt-3 flex flex-col gap-2">
                      <div>
                        <dt className="text-muted">Файл</dt>
                        <dd>
                          {material.file_name ??
                            (material.external_url ? (
                              <a
                                href={material.external_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent underline underline-offset-2"
                              >
                                ссылка на материал
                              </a>
                            ) : (
                              'не загружен'
                            ))}
                          {material.file_size !== null ? ` · ${formatFileSize(material.file_size)}` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Замечание</dt>
                        <dd>{material.reviewer_comment ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Срок досдачи</dt>
                        <dd>{material.fix_deadline ? formatMoscowHuman(material.fix_deadline) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Загружен</dt>
                        <dd>{formatMoscowHuman(material.created_at)}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={selected.has(material.id)}
                        aria-label={`Выбрать материал «${typeTitle}» команды ${teamName(material.team_id)}`}
                        onChange={(event) => toggleRow(material.id, event.target.checked)}
                      />
                      <span className="text-muted">Выбрать для массовой операции</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        loading={busyId === material.id}
                        disabled={material.media_id === null}
                        title={material.media_id === null ? 'Файл не загружен: команда передала материал ссылкой' : undefined}
                        onClick={() => void openFile(material)}
                      >
                        Открыть файл
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        loading={busyId === material.id}
                        onClick={() => void acceptOne(material)}
                      >
                        Принять
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-expanded={openFix === material.id}
                        onClick={() => {
                          setOpenFix(openFix === material.id ? null : material.id);
                          setFixDraft((current) => ({ ...current, [material.id]: draft }));
                        }}
                      >
                        Вернуть на доработку
                      </Button>
                    </div>
                    {openFix === material.id ? (
                      <div className="mt-4 flex flex-col gap-4 border border-border p-4">
                        <TextAreaField
                          id={`material-card-comment-${material.id}`}
                          label="Замечание команде"
                          value={draft.comment}
                          maxLength={3000}
                          required
                          onChange={(event) =>
                            setFixDraft((current) => ({
                              ...current,
                              [material.id]: { ...draft, comment: event.target.value },
                            }))
                          }
                          hint="Что именно исправить: текст увидит команда в личном кабинете."
                        />
                        <TextField
                          id={`material-card-deadline-${material.id}`}
                          label="Срок досдачи"
                          type="datetime-local"
                          value={draft.deadline}
                          onChange={(event) =>
                            setFixDraft((current) => ({
                              ...current,
                              [material.id]: { ...draft, deadline: event.target.value },
                            }))
                          }
                          hint="Оставьте пустым — сервер поставит срок сам: два рабочих дня. Время указывается по Москве."
                        />
                        <div className="flex flex-wrap gap-3">
                          <Button
                            type="button"
                            loading={busyId === material.id}
                            disabled={draft.comment.trim() === ''}
                            title={draft.comment.trim() === '' ? 'Без замечания возврат на доработку невозможен' : undefined}
                            onClick={() => void requestFix(material)}
                          >
                            Сохранить замечание
                          </Button>
                          <Button type="button" variant="quiet" onClick={() => setOpenFix(null)}>
                            Отменить
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </SectionCard>
    </main>
  );
}
