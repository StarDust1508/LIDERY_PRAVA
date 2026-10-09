import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminApiError, adminApi, formatMoscowHuman } from '@shared/index';
import { Alert, Button, CheckboxField, PageHeader, SectionCard, TextAreaField, TextField } from '@shared/index';

// Настройки конкурса (ТЗ 07, п. 2.16).
//
// Каждое изменение сохраняется вместе с ревизией и автором: сервер пишет
// историю значений, панель показывает её по кнопке «Ревизии». Значение —
// произвольный JSON, поэтому оно редактируется текстом с проверкой разбора.
//
// Включатели, меняющие ход конкурса (приём заявок, публикация результатов),
// вынесены в отдельный блок с предупреждением о последствиях (п. 3.2).

/** Строка настройки: key/value/updated_at объявлены в adminApi.settings(). */
interface SettingRow {
  key: string;
  value: unknown;
  /** Номер ревизии приходит только в истории изменений. */
  revision?: number;
  updated_at: string;
}

/** Поля, которые сервер отдаёт дополнительно (см. отчёт о расхождениях типов). */
interface SettingExtras {
  description?: string | null;
  updated_by?: string | null;
  /** ФИО и почта автора последнего изменения (из таблицы пользователей). */
  author_name?: string | null;
  author_email?: string | null;
}

interface RevisionRow {
  revision?: number;
  value: unknown;
  author?: string | null;
  actor?: string | null;
  created_at: string;
  /** ФИО и почта автора последнего изменения (из таблицы пользователей). */
  author_name?: string | null;
  author_email?: string | null;
}

const SETTING_LABELS: Record<string, string> = {
  'site.domain': 'Официальный домен конкурса',
  'site.founder_organization': 'Организация-учредитель конкурса',
  'site.timezone': 'Часовой пояс конкурса',
  'site.vk_community': 'Сообщество конкурса во «ВКонтакте»',
  'site.contact_email': 'Контактный e-mail Оргкомитета',
  'site.contact_phone': 'Контактный телефон Оргкомитета',
  'site.application_form_url': 'Ссылка на форму подачи заявки',
  'site.documents_acceptance_required': 'Требовать отметку о согласии с документами при подаче',
  'site.organizer_head': 'Руководитель Оргкомитета',
  'documents.current_version': 'Действующая редакция Положения и Приложений',
  'operator.name': 'Наименование оператора',
  'operator.address': 'Адрес оператора',
  'operator.ogrn': 'ОГРН оператора',
  'operator.inn': 'ИНН оператора',
  'operator.pdn_officer': 'Ответственный за организацию обработки ПДн',
  'mail.templates.application_received': 'Письмо: заявка получена',
  'mail.templates.material_needs_fix': 'Письмо: материал возвращён на доработку',
  'mail.templates.appeal_decision': 'Письмо: решение по апелляции',
  'mail.templates.access_link': 'Письмо: ссылка доступа в кабинет',
};

const GROUPS = [
  { prefix: 'site', title: 'Сайт, контакты и Оргкомитет' },
  { prefix: 'season', title: 'Сроки сезона' },
  { prefix: 'documents', title: 'Документы' },
  { prefix: 'features', title: 'Включатели функций' },
  // Реквизиты оператора и тексты писем раньше попадали в «Прочие настройки»,
  // хотя это отдельные сущности ТЗ 07, п. 2.16.
  { prefix: 'operator', title: 'Реквизиты оператора персональных данных' },
  { prefix: 'mail', title: 'Шаблоны писем' },
];

/**
 * Опасные настройки: их изменение сразу влияет на всех участников, поэтому
 * сохраняется только после отдельного подтверждения.
 */
const DANGEROUS_SETTINGS = [
  {
    test: /(application|applications)[._-]?(open|enabled|accept|accepting|closed)/i,
    warning:
      'Включатель приёма заявок: если выключить приём, команды не смогут подать или дополнить заявку — форма на сайте закроется для всех.',
  },
  {
    test: /(publish|publication|results?[._-]?published|show[._-]?results)/i,
    warning:
      'Включатель публикации результатов: если выключить публикацию, рейтинги и протоколы перестанут показываться на сайте у всех команд.',
  },
  // Остальные включатели тоже действуют немедленно: они уже подключены к
  // публичной части и кабинету, поэтому подтверждение нужно и для них.
  {
    test: /features\.appeals/i,
    warning:
      'Включатель апелляций: при выключении команды не смогут подать апелляцию по итогам этапа.',
  },
  {
    test: /features\.public_archive/i,
    warning:
      'Включатель архива законопроектов: при выключении раздел архива и карточки инициатив перестанут показываться на сайте.',
  },
  {
    test: /features\.masterclasses/i,
    warning:
      'Включатель мастер-классов: при выключении расписание мастер-классов исчезнет с сайта.',
  },
  {
    test: /features\.mailing/i,
    warning:
      'Включатель рассылки: пока он выключен, согласие на информационные сообщения не записывается.',
  },
] as const;

function dangerFor(key: string) {
  return DANGEROUS_SETTINGS.find((item) => item.test.test(key)) ?? null;
}

/**
 * Сервер отдаёт description и updated_by, а adminApi.settings() объявляет
 * только key/value/revision/updated_at (см. отчёт о расхождениях), поэтому
 * дополнительные поля читаются приведением, без правки общего типа.
 */
function extrasOf(setting: SettingRow): SettingExtras {
  return setting as unknown as SettingExtras;
}

function labelFor(key: string): string {
  const known = SETTING_LABELS[key];
  if (known !== undefined) return known;
  if (key.startsWith('season.')) return `Срок или параметр сезона «${key}»`;
  if (key.startsWith('features.')) return `Включатель функции «${key}»`;
  return `Настройка «${key}»`;
}

function groupTitle(key: string): string {
  const prefix = key.split('.')[0] ?? '';
  return GROUPS.find((group) => group.prefix === prefix)?.title ?? 'Прочие настройки';
}

/**
 * Вид настройки: включатель (логическое значение), письмо (тема и текст) или
 * произвольное значение. Раньше всё правилось сырым JSON, из-за чего включение
 * функции требовало вручную писать {"value": true}.
 */
type SettingKind =
  | { kind: 'bool'; value: boolean }
  | { kind: 'mail'; subject: string; body: string }
  | { kind: 'text'; value: string }
  | { kind: 'json'; value: unknown };

function settingKind(value: unknown): SettingKind {
  const payload = (value ?? {}) as Record<string, unknown>;
  if (typeof payload.value === 'boolean') return { kind: 'bool', value: payload.value };
  if (typeof payload.subject === 'string' || typeof payload.body === 'string') {
    return {
      kind: 'mail',
      subject: typeof payload.subject === 'string' ? payload.subject : '',
      body: typeof payload.body === 'string' ? payload.body : '',
    };
  }
  if (typeof payload.value === 'string') return { kind: 'text', value: payload.value };
  return { kind: 'json', value };
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value, null, 2);
  return JSON.stringify(value, null, 2) ?? 'null';
}

function jsonPreview(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return 'значение не задано';
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/** Ошибка объясняет, что делать (п. 3.5). */
function explain(caught: unknown, fallback: string): string {
  if (caught instanceof AdminApiError) {
    if (caught.status === 0) return `${caught.message} Проверьте соединение и повторите запрос.`;
    if (caught.status === 401 || caught.status === 403) {
      return `${caught.message} Раздел настроек доступен только администратору: войдите под учётной записью администратора.`;
    }
    return caught.message;
  }
  return fallback;
}

export function SettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Черновики понятных редакторов: тема и текст письма, текстовое значение.
  const [mailDraft, setMailDraft] = useState({ subject: '', body: '' });
  const [textDraft, setTextDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Record<string, RevisionRow[]>>({});
  const [revisionsLoading, setRevisionsLoading] = useState<string | null>(null);
  const [openRevisions, setOpenRevisions] = useState<string | null>(null);
  const [confirmDanger, setConfirmDanger] = useState<{ key: string; value: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await adminApi.settings();
      setRows(settings);
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить настройки.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    for (const row of rows) {
      const title = groupTitle(row.key);
      const list = map.get(title);
      if (list === undefined) map.set(title, [row]);
      else list.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  const dangerousRows = rows.filter((row) => dangerFor(row.key) !== null);
  const safeGroups = grouped
    .map(([title, list]) => [title, list.filter((row) => dangerFor(row.key) === null)] as const)
    .filter(([, list]) => list.length > 0);

  function startEdit(row: SettingRow) {
    setEditingKey(row.key);
    setDraft(jsonText(row.value));
    const parsed = settingKind(row.value);
    if (parsed.kind === 'mail') setMailDraft({ subject: parsed.subject, body: parsed.body });
    if (parsed.kind === 'text') setTextDraft(parsed.value);
    setDraftError(null);
    setNotice(null);
    setError(null);
  }

  async function persist(key: string, value: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await adminApi.saveSetting(key, value);
      setNotice(`Настройка «${key}» сохранена. Ревизия: ${saved.revision}.`);
      setEditingKey(null);
      setConfirmDanger(null);
      setRevisions((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
      await load();
    } catch (caught) {
      setError(explain(caught, `Не удалось сохранить настройку «${key}».`));
    } finally {
      setBusy(false);
    }
  }

  async function save(key: string) {
    const row = rows.find((item) => item.key === key);
    const view = row ? settingKind(row.value) : ({ kind: 'json', value: null } as const);
    let parsed: unknown;
    if (view.kind === 'bool') {
      parsed = { value: draft === 'true' };
    } else if (view.kind === 'mail') {
      if (mailDraft.subject.trim() === '' || mailDraft.body.trim() === '') {
        setDraftError('Заполните тему и текст письма.');
        return;
      }
      parsed = { subject: mailDraft.subject.trim(), body: mailDraft.body };
    } else if (view.kind === 'text') {
      parsed = { value: textDraft };
    } else {
      try {
        parsed = JSON.parse(draft);
      } catch {
        setDraftError('Значение должно быть корректным JSON. Например: {"value": "lideryprava.ru"}');
        return;
      }
    }
    setDraftError(null);
    if (dangerFor(key) !== null) {
      setConfirmDanger({ key, value: parsed });
      return;
    }
    await persist(key, parsed);
  }

  async function loadRevisions(key: string) {
    if (openRevisions === key) {
      setOpenRevisions(null);
      return;
    }
    setOpenRevisions(key);
    if (revisions[key] !== undefined) return;
    setRevisionsLoading(key);
    setError(null);
    try {
      const list = await adminApi.settingRevisions(key);
      setRevisions((current) => ({ ...current, [key]: list }));
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить историю изменений настройки.'));
    } finally {
      setRevisionsLoading(null);
    }
  }

  function renderSetting(row: SettingRow) {
    const isEditing = editingKey === row.key;
    return (
      <div key={row.key} className="border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-h3 font-semibold">{labelFor(row.key)}</h3>
            <p className="mono-label mt-1 text-muted">{row.key}</p>
          </div>
          <div className="text-right text-sm text-muted">
            {typeof row.revision === 'number' ? (
              <p>Ревизия: {row.revision === 0 ? 'изменений ещё не было' : row.revision}</p>
            ) : null}
            <p>Изменена: {formatMoscowHuman(row.updated_at)}</p>
            {extrasOf(row).author_name || extrasOf(row).author_email || extrasOf(row).updated_by ? (
              <p>
                Автор:{' '}
                {extrasOf(row).author_name ??
                  extrasOf(row).author_email ??
                  String(extrasOf(row).updated_by) === 'env:owner'
                    ? 'владелец (вход по паролю из окружения)'
                    : String(extrasOf(row).updated_by)}
              </p>
            ) : null}
          </div>
        </div>

        {extrasOf(row).description ? (
          <p className="mt-2 max-w-measure text-sm text-muted">{extrasOf(row).description}</p>
        ) : null}

        {isEditing ? (
          <div className="mt-4 flex flex-col gap-4">
            {/* Включатели и тексты писем правятся понятными полями: сырой JSON
                остаётся только для структур переменного состава. */}
            {settingKind(row.value).kind === 'bool' ? (
              <CheckboxField
                id={`setting-${row.key}`}
                label="Функция включена"
                checked={draft === 'true'}
                onChange={(checked) => setDraft(checked ? 'true' : 'false')}
                hint="Выключение действует сразу: раздел или приём перестают работать у всех."
              />
            ) : settingKind(row.value).kind === 'mail' ? (
              <div className="flex flex-col gap-4">
                <TextField
                  id={`setting-subject-${row.key}`}
                  label="Тема письма"
                  value={mailDraft.subject}
                  maxLength={300}
                  onChange={(event) => setMailDraft({ ...mailDraft, subject: event.target.value })}
                />
                <TextAreaField
                  id={`setting-body-${row.key}`}
                  label="Текст письма"
                  value={mailDraft.body}
                  maxLength={5000}
                  onChange={(event) => setMailDraft({ ...mailDraft, body: event.target.value })}
                  hint="Допустимы подстановки вида {{team_name}}, {{public_number}}, {{link}}."
                />
              </div>
            ) : settingKind(row.value).kind === 'text' ? (
              <TextField
                id={`setting-${row.key}`}
                label="Значение"
                value={textDraft}
                maxLength={1000}
                onChange={(event) => setTextDraft(event.target.value)}
              />
            ) : (
              <TextAreaField
                id={`setting-${row.key}`}
                label="Значение (JSON)"
                value={draft}
                error={draftError ?? undefined}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDraftError(null);
                }}
                hint='Структура переменного состава. Чаще всего это объект с одним полем: {"value": …}.'
              />
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="button" loading={busy} onClick={() => void save(row.key)}>
                Сохранить настройку
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingKey(null);
                  setDraftError(null);
                }}
              >
                Отменить
              </Button>
            </div>
          </div>
        ) : (
          <>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words border border-border bg-sand p-3 text-sm">
              {jsonText(row.value)}
            </pre>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={() => startEdit(row)}>
                Изменить значение
              </Button>
              <Button
                type="button"
                variant="secondary"
                aria-expanded={openRevisions === row.key}
                aria-controls={`revisions-${row.key}`}
                onClick={() => void loadRevisions(row.key)}
              >
                Ревизии
              </Button>
            </div>
          </>
        )}

        {openRevisions === row.key ? (
          <div id={`revisions-${row.key}`} className="mt-4 border-t border-border pt-4">
            {revisionsLoading === row.key ? <p role="status">Загружаем историю изменений…</p> : null}
            {(revisions[row.key] ?? []).length === 0 && revisionsLoading !== row.key ? (
              <p className="text-sm text-muted">
                История изменений пуста: значение ещё не меняли через панель.
              </p>
            ) : null}
            {(revisions[row.key] ?? []).length > 0 ? (
              <ul className="flex flex-col gap-3">
                {(revisions[row.key] ?? []).map((revision, index) => (
                  <li key={`${row.key}-${index}`} className="border border-border p-3 text-sm">
                    <p className="mono-label text-muted">
                      Ревизия {typeof revision.revision === 'number' ? revision.revision : index + 1} ·{' '}
                      {formatMoscowHuman(revision.created_at)}
                    </p>
                    <p className="mt-1">
                      Автор: {revision.author ?? revision.actor ?? 'система'}
                    </p>
                    <p className="mt-1 break-words text-muted">{jsonPreview(revision.value)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Правила конкурса"
        title="Настройки"
        lead="Сроки сезона, контакты Оргкомитета и включатели функций. Каждое изменение сохраняется с ревизией и автором — прежние значения не удаляются."
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

      {loading && rows.length === 0 ? <p role="status">Загружаем настройки…</p> : null}

      {!loading && rows.length === 0 ? (
        <Alert tone="info" title="Настройки не заполнены">
          В базе нет ни одной настройки. Значения появляются вместе с сезоном: проверьте, что миграции справочных данных
          применены, и обновите список.
        </Alert>
      ) : null}

      {safeGroups.map(([title, list]) => (
        <SectionCard key={title} title={title} description={`Настроек в разделе: ${list.length}.`}>
          <div className="flex flex-col gap-5">{list.map((row) => renderSetting(row))}</div>
        </SectionCard>
      ))}

      {confirmDanger ? (
        <Alert tone="danger" title="Опасное изменение: подтвердите">
          <p>
            {dangerFor(confirmDanger.key)?.warning} Новое значение:{' '}
            <span className="break-words font-mono">{jsonPreview(confirmDanger.value)}</span>
          </p>
          <p className="mt-2">
            Изменение вступит в силу сразу после сохранения и попадёт в ревизии с вашим именем.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" loading={busy} onClick={() => void persist(confirmDanger.key, confirmDanger.value)}>
              Подтвердить изменение
            </Button>
            <Button type="button" variant="quiet" onClick={() => setConfirmDanger(null)}>
              Отменить
            </Button>
          </div>
        </Alert>
      ) : null}

      <SectionCard
        title="Опасные изменения"
        description="Включатели, которые сразу влияют на всех участников конкурса. Изменение выполняется отдельно от повседневных настроек и требует подтверждения."
      >
        {dangerousRows.length === 0 ? (
          <p className="max-w-measure text-sm text-muted">
            Включателей приёма заявок и публикации результатов среди настроек нет. Приём заявок определяется сроками
            сезона (<span className="font-mono">application_open_at</span> и{' '}
            <span className="font-mono">application_close_at</span>), а публикация результатов — протоколом этапа в
            разделе «Рейтинг». Если такой включатель появится в настройках, он будет выделен здесь автоматически.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {dangerousRows.map((row) => (
              <div key={`danger-${row.key}`} className="flex flex-col gap-3">
                <Alert tone="warning" title={labelFor(row.key)}>
                  <p>{dangerFor(row.key)?.warning}</p>
                </Alert>
                {renderSetting(row)}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </main>
  );
}
