import { useCallback, useEffect, useState } from 'react';
import { AdminApiError, EVALUATION_STAGES, TextField, adminApi, evaluationStageTitle, formatMoscowHuman, teamStatusTitle, type Ranking } from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField } from '@shared/index';

// Рейтинг этапа: расчёт по пункту 7.7 (среднее арифметическое сумм членов
// комиссии; расхождение сумм показывается справочно)
// и публикация протокола. Публикация — единственный способ показать баллы
// участникам и точка отсчёта срока апелляции (п. 12.1).

export function RankingsPage({ canPublish = true }: { canPublish?: boolean }) {
  const [seasons, setSeasons] = useState<Array<{ id: number; title: string; is_active: boolean }>>([]);
  const [seasonId, setSeasonId] = useState('');
  const [stage, setStage] = useState<string>('selection');
  const [teams, setTeams] = useState<Array<{ id: number; name: string; status: string }>>([]);
  const [rows, setRows] = useState<Ranking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await adminApi.seasons();
        if (!active) return;
        setSeasons(data);
        const activeSeason = data.find((season) => season.is_active) ?? data[0];
        if (activeSeason) setSeasonId(String(activeSeason.id));
      } catch (caught) {
        if (active) setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить сезоны.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (seasonId === '') return;
    setLoading(true);
    setError(null);
    try {
      const [rankings, teamList] = await Promise.all([
        adminApi.rankings({ season_id: Number(seasonId), stage }),
        adminApi.teams(Number(seasonId)),
      ]);
      setRows(rankings);
      setTeams(teamList);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить рейтинг.');
    } finally {
      setLoading(false);
    }
  }, [seasonId, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadProtocol() {
    if (!protocolFile || seasonId === '') return;
    setProtocolBusy(true);
    setError(null);
    try {
      const result = await adminApi.uploadRankingsProtocol(Number(seasonId), stage, protocolFile);
      setProtocolFile(null);
      setNotice(`Протокол загружен, записей обновлено: ${result.rows}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить протокол.');
    } finally {
      setProtocolBusy(false);
    }
  }

  async function removeProtocol() {
    if (seasonId === '') return;
    setProtocolBusy(true);
    setError(null);
    try {
      await adminApi.removeRankingsProtocol(Number(seasonId), stage);
      setNotice('Протокол убран: ссылка исчезнет из личного кабинета участников.');
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось убрать протокол.');
    } finally {
      setProtocolBusy(false);
    }
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Действие не выполнено.');
    } finally {
      setBusy(false);
    }
  }

  const teamName = (id: number) => teams.find((team) => team.id === id)?.name ?? `Команда ${id}`;
  const teamStatus = (id: number) => teams.find((team) => team.id === id)?.status ?? '';
  const published = rows.filter((row) => row.is_published).length;
  const currentProtocolUrl =
    (rows.find((row) => (row as { protocol_url?: string | null }).protocol_url) as
      | { protocol_url?: string | null }
      | undefined)?.protocol_url ?? null;
  // Подтверждение публикации и снятия протокола (ТЗ 07, п. 1.5, 2.8).
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState('');
  // PDF протокола этапа (ТЗ 07, п. 2.8): загружается вместе с публикацией.
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [protocolBusy, setProtocolBusy] = useState(false);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Протокол этапа"
        title="Рейтинг и публикация"
        lead="Расчёт выполняется по пункту 7.7 Положения. Публикация открывает баллы участникам и запускает срок подачи апелляций."
        aside={
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              loading={busy}
              disabled={seasonId === ''}
              onClick={() =>
                void run(async () => {
                  const result = await adminApi.recalculateRankings(Number(seasonId), stage);
                  return result.message ?? `Расчёт выполнен: в рейтинге ${result.teams.length} команд.`;
                })
              }
            >
              Пересчитать рейтинг
            </Button>
            <Button
              loading={busy}
              disabled={!canPublish || seasonId === '' || rows.length === 0}
              title={
                canPublish
                  ? undefined
                  : 'Публикация протокола доступна только роли «администратор» (ТЗ 07, п. 1.3).'
              }
              onClick={() => setConfirmPublish(true)}
            >
              Опубликовать протокол
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={!canPublish || seasonId === '' || published === 0}
              title={
                canPublish
                  ? undefined
                  : 'Снятие с публикации доступно только роли «администратор» (ТЗ 07, п. 2.8).'
              }
              onClick={() => setConfirmUnpublish(true)}
            >
              Снять с публикации
            </Button>
          </div>
        }
      />

      {/* Публикация протокола — необратимое для участников действие: сначала
          подтверждение с последствиями (ТЗ 07, п. 1.5). */}
      {confirmPublish ? (
        <Alert tone="warning" title="Опубликовать протокол этапа?">
          <p>
            Рейтинг станет видимым на сайте, а для этапов с апелляцией откроется срок её подачи. Снять протокол
            можно только отдельным решением с указанием причины.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              loading={busy}
              onClick={() => {
                setConfirmPublish(false);
                void run(async () => {
                  const result = await adminApi.publishRankings(Number(seasonId), stage);
                  const ties = result.ties ?? [];
                  const withoutEvaluations = result.without_evaluations ?? [];
                  const warnings = result.warnings ?? [];
                  const parts = [result.message ?? `Опубликовано записей: ${result.published}.`];
                  if (warnings.length > 0) {
                    parts.push(`Замечания: ${warnings.join(' ')}`);
                  }
                  if (ties.length > 0) {
                    parts.push(
                      `Равные баллы: ${ties.map((tie) => `${tie.team} (${tie.place} место)`).join(', ')}.`
                    );
                  }
                  if (withoutEvaluations.length > 0) {
                    parts.push(`Без оценок: ${withoutEvaluations.join(', ')}.`);
                  }
                  return parts.join(' ');
                });
              }}
            >
              Опубликовать
            </Button>
            <Button variant="quiet" onClick={() => setConfirmPublish(false)}>
              Отменить
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* Снятие с публикации — только с причиной (ТЗ 07, п. 2.8). */}
      {confirmUnpublish ? (
        <Alert tone="danger" title="Снять протокол с публикации?">
          <p>Протокол исчезнет с сайта, а причина попадёт в журнал действий Оргкомитета.</p>
          <div className="mt-3 flex flex-col gap-3">
            <TextField
              id="unpublish-reason"
              label="Причина снятия"
              value={unpublishReason}
              onChange={(event) => setUnpublishReason(event.target.value)}
              hint="Например: обнаружена ошибка подсчёта, требуется повторная оценка."
            />
            <div className="flex flex-wrap gap-3">
              <Button
                loading={busy}
                disabled={unpublishReason.trim().length < 3}
                onClick={() => {
                  const reason = unpublishReason.trim();
                  setConfirmUnpublish(false);
                  void run(async () => {
                    const result = await adminApi.publishRankings(Number(seasonId), stage, false, reason);
                    return result.message ?? 'Протокол снят с публикации.';
                  });
                }}
              >
                Снять с публикации
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setConfirmUnpublish(false);
                  setUnpublishReason('');
                }}
              >
                Оставить
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <SectionCard
        title="PDF протокола этапа"
        description="Протокол публикуется вместе с рейтингом: участники скачивают его из личного кабинета."
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="md:w-96">
            <label className="mono-label text-muted" htmlFor="protocol-file">
              Файл протокола (PDF)
            </label>
            <input
              id="protocol-file"
              type="file"
              accept="application/pdf"
              className="mt-2 block w-full border border-border-strong bg-raised px-3 py-2 text-sm"
              onChange={(event) => setProtocolFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Button
              type="button"
              loading={protocolBusy}
              disabled={protocolFile === null || seasonId === ''}
              onClick={() => void uploadProtocol()}
            >
              Загрузить протокол
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={protocolBusy}
              disabled={seasonId === '' || currentProtocolUrl === null}
              onClick={() => void removeProtocol()}
            >
              Убрать протокол
            </Button>
          </div>
        </div>
        {currentProtocolUrl ? (
          <p className="mt-3 text-sm">
            Текущий протокол:{' '}
            <a className="text-accent underline underline-offset-2" href={currentProtocolUrl} target="_blank" rel="noreferrer">
              открыть PDF
            </a>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">Протокол этого этапа ещё не загружен.</p>
        )}
      </SectionCard>

      <SectionCard title="Этап" description={`Записей в рейтинге: ${rows.length}; опубликовано: ${published}.`}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            id="rankings-season"
            label="Сезон"
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
            placeholder="Выберите сезон"
            options={seasons.map((season) => ({
              value: season.id,
              title: `${season.title}${season.is_active ? ' (активный)' : ''}`,
            }))}
          />
          <SelectField
            id="rankings-stage"
            label="Этап"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            options={EVALUATION_STAGES.map((item) => ({ value: item.value, title: item.title }))}
          />
        </div>
      </SectionCard>

      <SectionCard title={`Рейтинг · ${evaluationStageTitle(stage)}`}>
        {loading ? (
          <p role="status">Считаем рейтинг…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">Рейтинг ещё не рассчитан: нажмите «Пересчитать рейтинг» после внесения оценок.</p>
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <caption className="sr-only-text">Рейтинг команд этапа</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">Место</th>
                  <th scope="col" className="py-2 pr-4">Команда</th>
                  <th scope="col" className="py-2 pr-4">Средний балл</th>
                  <th scope="col" className="py-2 pr-4">Сумма Жюри</th>
                  <th scope="col" className="py-2 pr-4">Разброс</th>
                  <th scope="col" className="py-2 pr-4">Оценок</th>
                  <th scope="col" className="py-2 pr-4">Состояние</th>
                  <th scope="col" className="py-2">Публикация</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="py-2 pr-4 font-mono">{row.place}</td>
                    <td className="py-2 pr-4">
                      {teamName(row.team_id)}
                      <span className="block text-muted">{teamStatusTitle(teamStatus(row.team_id))}</span>
                    </td>
                    <td className="py-2 pr-4">{Number(row.average_score).toFixed(2)}</td>
                    <td className="py-2 pr-4">{row.jury_total === null ? '—' : Number(row.jury_total).toFixed(2)}</td>
                    <td className="py-2 pr-4">{row.scores_spread === null ? '—' : Number(row.scores_spread).toFixed(2)}</td>
                    <td className="py-2 pr-4">{row.evaluations_count}</td>
                    <td className="py-2 pr-4">
                      {row.needs_chair_review ? (
                        <span className="text-muted">расхождение сумм — справочно</span>
                      ) : (
                        <span className="text-muted">расчёт готов</span>
                      )}
                    </td>
                    <td className="py-2">
                      {row.is_published ? `опубликован ${formatMoscowHuman(row.published_at)}` : 'не опубликован'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* На узких экранах рейтинг читается карточками (ТЗ 08, п. 3.6). */}
            <ol className="flex flex-col gap-4 md:hidden">
              {rows.map((row) => (
                <li key={`card-${row.id}`} className="border border-border p-4 text-sm">
                  <p className="font-semibold">
                    {row.place} место · {teamName(row.team_id)}
                  </p>
                  <p className="mt-1 text-muted">{teamStatusTitle(teamStatus(row.team_id))}</p>
                  <dl className="mt-3 flex flex-col gap-1">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Средний балл</dt>
                      <dd>{Number(row.average_score).toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Сумма Жюри</dt>
                      <dd>{row.jury_total === null ? '—' : Number(row.jury_total).toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Разброс</dt>
                      <dd>{row.scores_spread === null ? '—' : Number(row.scores_spread).toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Оценок</dt>
                      <dd>{row.evaluations_count}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Состояние</dt>
                      <dd>расчёт готов</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Публикация</dt>
                      <dd>{row.is_published ? formatMoscowHuman(row.published_at) : 'не опубликован'}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </>
        )}
      </SectionCard>
    </main>
  );
}
