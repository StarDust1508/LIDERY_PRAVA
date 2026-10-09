import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AdminApiError,
  type AdminAppeal,
  adminApi,
  APPEAL_GROUNDS,
  APPEAL_STATUS_TITLES,
  formatMoscowHuman,
  pluralize,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField, StatusBadge, TextAreaField, TextField } from '@shared/index';

// Апелляции команд и решения апелляционной комиссии (ТЗ 07, п. 2.9).
//
// Срок рассмотрения из Положения исключён: панель показывает только состояние
// «не рассмотрена / рассмотрена», без расчётных дат.
//
// Решение фиксируется с обоснованием и ссылкой на протокол, поэтому отделено
// от повседневных действий и требует подтверждения (п. 3.2).

const APPEAL_STAGE_TITLES: Record<string, string> = {
  selection: 'Отборочный этап',
  stage1: 'Первый этап',
  final: 'Второй (финальный) этап',
};

const DECIDED_STATUSES = ['granted', 'partially_granted', 'rejected', 'withdrawn'];

const TERM_TITLES: Record<string, string> = {
  open: 'Не рассмотрена',
  reviewed: 'Рассмотрена',
};

/** Формулировки решений — из ТЗ 07, п. 2.9: удовлетворить / частично / отказать. */
const DECISIONS = [
  {
    status: 'granted',
    label: 'Удовлетворить',
    hint: 'Итог этапа пересматривается в пользу команды.',
  },
  {
    status: 'partially_granted',
    label: 'Удовлетворить частично',
    hint: 'Удовлетворяется часть требований апелляции.',
  },
  {
    status: 'rejected',
    label: 'Отказать',
    hint: 'Основания апелляции признаны неубедительными.',
  },
] as const;

/** Дополнительные поля апелляции, которые отдаёт сервер (см. отчёт о расхождениях). */
interface AppealExtras {
  decision_note?: string | null;
  protocol_url?: string | null;
  reviewed_at?: string | null;
  /** Ссылка на скан, приложенный командой (ТЗ 07, п. 2.9). */
  scan_url?: string | null;
}

type TermKey = 'open' | 'reviewed';

/** Рабочие дни считаются по тому же правилу, что и на сервере (без субботы и воскресенья). */
function termOf(appeal: AdminAppeal): TermKey {
  return DECIDED_STATUSES.includes(appeal.status ?? 'submitted') ? 'reviewed' : 'open';
}

/**
 * Сервер отдаёт decision_note и protocol_url, а общий тип AdminAppeal объявляет
 * поле decision_reason (см. отчёт о расхождениях). Поля читаются приведением,
 * чтобы не править общий модуль типов.
 */
function extrasOf(appeal: AdminAppeal): AppealExtras {
  return appeal as unknown as AppealExtras;
}

function groundsTitle(value: string): string {
  return APPEAL_GROUNDS.find((item) => item.value === value)?.title ?? value;
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

export function AppealsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const stage = searchParams.get('stage') ?? '';
  const term = searchParams.get('term') ?? '';

  const [rows, setRows] = useState<AdminAppeal[]>([]);
  const [teamNames, setTeamNames] = useState<Map<number, string>>(new Map());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [protocolUrl, setProtocolUrl] = useState('');
  const [confirm, setConfirm] = useState<{ status: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appeals, teams] = await Promise.all([
        adminApi.appeals({
          status: status === '' ? undefined : status,
          stage: stage === '' ? undefined : stage,
        }),
        adminApi.teams().catch(() => []),
      ]);
      setRows(appeals);
      setTeamNames(new Map(teams.map((team) => [team.id, team.name])));
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить список апелляций.'));
    } finally {
      setLoading(false);
    }
  }, [status, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  const visible = term === '' ? rows : rows.filter((appeal) => termOf(appeal) === term);
  const selected = rows.find((appeal) => appeal.id === selectedId) ?? null;

  const termCounts = (['open', 'reviewed'] as TermKey[]).map((key) => ({
    key,
    count: rows.filter((appeal) => termOf(appeal) === key).length,
  }));

  function openAppeal(appeal: AdminAppeal) {
    setSelectedId(appeal.id);
    setReason('');
    setProtocolUrl(extrasOf(appeal).protocol_url ?? '');
    setConfirm(null);
    setError(null);
    setNotice(null);
  }

  async function takeInReview(appeal: AdminAppeal) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Переводим только статус: пустой decision раньше стирал уже принятое
      // решение, если апелляцию возвращали в работу после решения.
      await adminApi.decideAppeal(appeal.id, { status: 'in_review' });
      setNotice(`Апелляция № ${appeal.id} принята в работу.`);
      await load();
    } catch (caught) {
      setError(explain(caught, 'Не удалось принять апелляцию в работу.'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(appeal: AdminAppeal, decision: string, label: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        status: decision,
        decision: label,
        decision_note: reason.trim(),
        protocol_url: protocolUrl.trim() === '' ? null : protocolUrl.trim(),
      };
      await adminApi.decideAppeal(appeal.id, payload);
      setNotice(`Решение по апелляции № ${appeal.id} зафиксировано: «${label}».`);
      setConfirm(null);
      setReason('');
      await load();
    } catch (caught) {
      setError(explain(caught, 'Решение не сохранено. Проверьте обоснование и повторите.'));
    } finally {
      setBusy(false);
    }
  }

  const teamName = (teamId: number): string => teamNames.get(teamId) ?? `Команда № ${teamId}`;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Апелляционная комиссия"
        title="Апелляции"
        lead="Апелляции по итогам отборочного и первого этапов. Решение фиксируется с обоснованием и ссылкой на протокол."
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
        description={`Апелляций в выборке: ${rows.length}. По сроку рассмотрения: в сроке — ${termCounts[0]?.count ?? 0}, просрочено — ${termCounts[1]?.count ?? 0}, рассмотрено — ${termCounts[2]?.count ?? 0}.`}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            id="appeals-status"
            label="Статус апелляции"
            value={status}
            options={Object.entries(APPEAL_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
            placeholder="Все статусы"
            onChange={(event) => setParam('status', event.target.value)}
          />
          <SelectField
            id="appeals-stage"
            label="Этап"
            value={stage}
            options={[
              { value: 'selection', title: APPEAL_STAGE_TITLES['selection'] ?? 'Отборочный этап' },
              { value: 'stage1', title: APPEAL_STAGE_TITLES['stage1'] ?? 'Первый этап' },
            ]}
            placeholder="Все этапы"
            onChange={(event) => setParam('stage', event.target.value)}
          />
          <SelectField
            id="appeals-term"
            label="Состояние"
            value={term}
            options={[
              { value: 'open', title: 'Не рассмотрена' },
              { value: 'reviewed', title: 'Рассмотрена' },
            ]}
            placeholder="Любое состояние"
            onChange={(event) => setParam('term', event.target.value)}
          />
        </div>
        {status !== '' || stage !== '' || term !== '' ? (
          <div className="mt-4">
            <Button type="button" variant="quiet" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              Сбросить фильтры
            </Button>
          </div>
        ) : null}
      </SectionCard>

      {selected ? (
        <SectionCard
          title={`Апелляция № ${selected.id}`}
          description={`${APPEAL_STAGE_TITLES[selected.stage] ?? selected.stage} · команда ${teamName(selected.team_id)} · подана ${formatMoscowHuman(selected.created_at)}`}
          actions={
            <Button type="button" variant="quiet" onClick={() => setSelectedId(null)}>
              Закрыть карточку
            </Button>
          }
        >
          <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
            <div>
              <dt className="mono-label text-muted">Команда</dt>
              <dd>
                <Link
                  to={`/teams?q=${encodeURIComponent(teamName(selected.team_id))}`}
                  className="text-accent underline underline-offset-2"
                >
                  {teamName(selected.team_id)}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Этап</dt>
              <dd>{APPEAL_STAGE_TITLES[selected.stage] ?? selected.stage}</dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Предмет апелляции (п. 12.2 Положения)</dt>
              <dd>{groundsTitle(selected.grounds)}</dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Статус</dt>
              <dd>
                <StatusBadge
                  status={selected.status ?? 'submitted'}
                  title={APPEAL_STATUS_TITLES[selected.status ?? 'submitted'] ?? selected.status ?? 'Подана'}
                />
                <span className="mt-1 block text-muted">
                  {TERM_TITLES[termOf(selected)]}
                </span>
              </dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Срок подачи по регламенту</dt>
              <dd>{selected.deadline_at ? formatMoscowHuman(selected.deadline_at) : '—'}</dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Решение</dt>
              <dd>
                {selected.decision ?? 'решение не принято'}
                {extrasOf(selected).decision_note ? (
                  <span className="mt-1 block text-muted">Обоснование: {extrasOf(selected).decision_note}</span>
                ) : null}
                {typeof extrasOf(selected).reviewed_at === 'string' && extrasOf(selected).reviewed_at !== '' ? (
                  <span className="mt-1 block text-muted">
                    Дата решения: {formatMoscowHuman(String(extrasOf(selected).reviewed_at))}
                  </span>
                ) : null}
                {typeof extrasOf(selected).protocol_url === 'string' && extrasOf(selected).protocol_url !== '' ? (
                  <a
                    href={String(extrasOf(selected).protocol_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-accent underline underline-offset-2"
                  >
                    Протокол апелляционной комиссии
                  </a>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="mt-5">
            <p className="mono-label text-muted">Текст апелляции</p>
            <p className="mt-2 max-w-measure whitespace-pre-line break-words">{selected.text}</p>
            {typeof extrasOf(selected).scan_url === 'string' && extrasOf(selected).scan_url !== '' ? (
              <p className="mt-3">
                <a
                  href={String(extrasOf(selected).scan_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  Приложенный командой документ
                </a>
                <span className="ml-2 text-sm text-muted">
                  открывается по админ-сессии: файл приватный и команде не публикуется
                </span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">Команда не приложила документ — апелляция подана текстом.</p>
            )}
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="mono-label text-muted">Принять в работу</p>
            <p className="mt-2 text-sm text-muted">
              Пока апелляция не принята в работу, комиссия не приступала к рассмотрению.
            </p>
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                loading={busy}
                disabled={(selected.status ?? 'submitted') !== 'submitted'}
                title={
                  (selected.status ?? 'submitted') === 'submitted'
                    ? undefined
                    : 'Апелляция уже принята в работу или рассмотрена'
                }
                onClick={() => void takeInReview(selected)}
              >
                Принять в работу
              </Button>
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="mono-label text-danger">Решение апелляционной комиссии</p>
            <p className="mt-2 max-w-measure text-sm text-muted">
              Решение фиксируется с автором и временем и попадает в журнал действий; команда увидит его в личном
              кабинете. Обоснование обязательно — без него решение не сохраняется.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              <TextAreaField
                id="appeal-reason"
                label="Обоснование решения"
                value={reason}
                maxLength={5000}
                required
                onChange={(event) => setReason(event.target.value)}
                hint="Что установила комиссия и на основании чего принято решение."
              />
              <TextField
                id="appeal-protocol"
                label="Ссылка на протокол апелляционной комиссии"
                value={protocolUrl}
                maxLength={2000}
                onChange={(event) => setProtocolUrl(event.target.value)}
                placeholder="https://…"
                hint="Необязательно: ссылка на опубликованный протокол или его скан."
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {DECISIONS.map((decision) => (
                <Button
                  key={decision.status}
                  type="button"
                  variant="secondary"
                  disabled={reason.trim() === ''}
                  title={reason.trim() === '' ? 'Сначала укажите обоснование решения' : undefined}
                  onClick={() => setConfirm({ status: decision.status, label: decision.label })}
                >
                  {decision.label}
                </Button>
              ))}
            </div>
            {reason.trim() === '' ? (
              <p className="mt-2 text-sm text-muted">
                Обоснование не заполнено: решения недоступны, пока в поле «Обоснование решения» нет текста.
              </p>
            ) : null}
            {confirm ? (
              <div className="mt-4">
                <Alert tone="warning" title={`Подтвердите решение: «${confirm.label}»`}>
                  <p>
                    {DECISIONS.find((decision) => decision.status === confirm.status)?.hint}
                    {DECISIONS.find((decision) => decision.status === confirm.status)?.hint ? ' ' : ''}
                    {DECIDED_STATUSES.includes(selected.status ?? '')
                      ? 'Прежнее решение будет заменено, изменение попадёт в журнал действий.'
                      : 'Изменить решение после подтверждения можно только новым решением — оно тоже попадёт в журнал.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button
                      type="button"
                      loading={busy}
                      onClick={() => void decide(selected, confirm.status, confirm.label)}
                    >
                      Подтвердить решение
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => setConfirm(null)}>
                      Отменить
                    </Button>
                  </div>
                </Alert>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Очередь апелляций" description="Новые сверху. Карточка открывается кнопкой «Открыть».">
        {loading && rows.length === 0 ? <p role="status">Загружаем апелляции…</p> : null}

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-muted">
            {status === '' && stage === '' && term === ''
              ? 'Апелляций нет. Они появятся здесь, когда капитан команды подаст апелляцию через личный кабинет.'
              : 'По этим условиям апелляций нет. Измените фильтры или сбросьте их.'}
          </p>
        ) : null}

        {rows.length > 0 && visible.length === 0 ? (
          <p className="text-sm text-muted">По выбранному сроку апелляций нет. Сбросьте фильтр по сроку.</p>
        ) : null}

        {visible.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1040px] border-collapse text-sm">
                <caption className="sr-only-text">Апелляции команд</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4">
                      Подана
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Команда
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Этап
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Предмет
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Состояние
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Статус
                    </th>
                    <th scope="col" className="py-2">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((appeal) => {
                    const termKey = termOf(appeal);
                    return (
                      <tr key={appeal.id} className="border-b border-border align-top">
                        <td className="py-3 pr-4">{formatMoscowHuman(appeal.created_at)}</td>
                        <td className="py-3 pr-4">{teamName(appeal.team_id)}</td>
                        <td className="py-3 pr-4">{APPEAL_STAGE_TITLES[appeal.stage] ?? appeal.stage}</td>
                        <td className="py-3 pr-4 max-w-measure break-words">{groundsTitle(appeal.grounds)}</td>
                        <td className="py-3 pr-4">
                          <span>{TERM_TITLES[termKey]}</span>
                        </td>
                        <td className="py-3 pr-4">
                          {APPEAL_STATUS_TITLES[appeal.status ?? 'submitted'] ?? appeal.status ?? 'Подана'}
                        </td>
                        <td className="py-3">
                          <Button
                            type="button"
                            variant="secondary"
                            aria-expanded={selectedId === appeal.id}
                            onClick={() => openAppeal(appeal)}
                          >
                            Открыть
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* На узких экранах таблица превращается в карточки (ТЗ 08, п. 3.6). */}
            <ul className="flex flex-col gap-4 md:hidden">
              {visible.map((appeal) => {
                const termKey = termOf(appeal);
                return (
                  <li key={`card-${appeal.id}`} className="border border-border p-4 text-sm">
                    <p className="mono-label text-muted">{formatMoscowHuman(appeal.created_at)}</p>
                    <p className="mt-1 font-semibold">{teamName(appeal.team_id)}</p>
                    <p className="mt-1 text-muted">{APPEAL_STAGE_TITLES[appeal.stage] ?? appeal.stage}</p>
                    <p className="mt-2">{groundsTitle(appeal.grounds)}</p>
                    <dl className="mt-3 flex flex-col gap-2">
                      <div>
                        <dt className="text-muted">Состояние</dt>
                        <dd>{TERM_TITLES[termKey]}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Статус</dt>
                        <dd>{APPEAL_STATUS_TITLES[appeal.status ?? 'submitted'] ?? appeal.status ?? 'Подана'}</dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-expanded={selectedId === appeal.id}
                        onClick={() => openAppeal(appeal)}
                      >
                        Открыть
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 text-sm text-muted">
              Показано апелляций: {pluralize(visible.length, ['апелляция', 'апелляции', 'апелляций'])}.
            </p>
          </>
        ) : null}
      </SectionCard>
    </main>
  );
}
