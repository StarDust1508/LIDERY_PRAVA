import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AdminApiError,
  EVALUATION_STAGES,
  adminApi,
  evaluationStageTitle,
  formatMoscowHuman,
  type Criterion,
  type Evaluation,
  type Expert,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField, TextAreaField, TextField } from '@shared/index';

// Оценочный лист по форме Приложения № 9: по каждому критерию — балл
// и обоснование, затем итог и рекомендации команде. Каждый член комиссии
// выставляет оценку независимо; повторная оценка тем же экспертом обновляет
// прежнюю запись (п. 7.6).

interface ScoreDraft {
  score: string;
  comment: string;
}

// Оценки вносят эксперты и члены Жюри; роль влияет только на публикацию
// протокола, поэтому здесь права не различаются — публикация живёт в «Рейтинге».
export function EvaluationPage() {
  const params = useParams();
  const [stage, setStage] = useState<string>('selection');
  const [teamId, setTeamId] = useState<string>(params.teamId ?? '');
  const [expertId, setExpertId] = useState<string>('');
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [teams, setTeams] = useState<Array<{ id: number; name: string }>>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [scores, setScores] = useState<Record<number, ScoreDraft>>({});
  const [comment, setComment] = useState('');
  const [recommendations, setRecommendations] = useState('');
  // Конфликт интересов (ТЗ 07, п. 2.7): оценка остаётся в истории, но в подсчёт
  // не входит. Причина обязательна — решение должно быть объяснимо.
  const [isConflicted, setIsConflicted] = useState(false);
  const [conflictReason, setConflictReason] = useState('');
  // Доступ эксперта к внесению оценок (ТЗ 07, п. 2.5): разовая ссылка и отзыв.
  const [expertAccessId, setExpertAccessId] = useState('');
  const [expertAccessUrl, setExpertAccessUrl] = useState<string | null>(null);
  const [expertAccessDays, setExpertAccessDays] = useState('14');
  const [expertAccessBusy, setExpertAccessBusy] = useState(false);
  const [expertAccessInfo, setExpertAccessInfo] = useState<string | null>(null);
  // История выдач и обращений эксперта: маршрут на сервере был, но панель его
  // не показывала — Оргкомитет не видел, кто получил ссылку и когда её открыл.
  const [expertAccessHistory, setExpertAccessHistory] = useState<{
    tokens: Array<{ id: number; label: string | null; created_at?: string; expires_at: string; revoked_at: string | null; used_count: number; last_used_at: string | null }>;
    log: Array<{ event: string; created_at: string }>;
  } | null>(null);
  // Матрица «команда × эксперт» с прогрессом заполнения (ТЗ 07, п. 2.7).
  // Активный сезон нужен и после сохранения оценки: по нему перезагружается матрица.
  const [matrixSeasonId, setMatrixSeasonId] = useState<number | null>(null);
  const [matrix, setMatrix] = useState<{
    experts: Array<{ id: number; full_name: string; role: string | null }>;
    rows: Array<{
      team_id: number;
      team_name: string;
      direction_title: string | null;
      cells: Array<{ expert_id: number; filled: boolean; total_score: string | number | null; is_conflicted: boolean }>;
      evaluations_count: number;
      is_ready: boolean;
    }>;
    } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Баллы относятся к конкретной работе: при смене команды, этапа или
  // эксперта черновик сбрасывается, иначе оценка уходила другой команде
  // (сервер делает upsert по паре «работа + эксперт»).
  useEffect(() => {
    setScores({});
    setIsConflicted(false);
    setConflictReason('');
  }, [teamId, stage, expertId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [criteriaData, expertsData, teamsData, seasonsData] = await Promise.all([
          adminApi.criteria(stage),
          adminApi.experts(),
          adminApi.teams(),
          adminApi.seasons(),
        ]);
        if (!active) return;
        setCriteria(criteriaData);
        setExperts(expertsData.filter((expert) => expert.stage === stage && expert.is_active));
        setTeams(teamsData);
        // Матрица заполняется по активному сезону: она показывает готовность
        // этапа к публикации протокола.
        const activeSeason = seasonsData.find((season) => season.is_active) ?? seasonsData[0];
        if (activeSeason) {
          setMatrixSeasonId(activeSeason.id);
          void adminApi
            .evaluationMatrix(activeSeason.id, stage)
            .then((data) => {
              if (active) setMatrix(data);
            })
            .catch(() => undefined);
        }
        setScores((current) => {
          const next = { ...current };
          for (const criterion of criteriaData) {
            if (!next[criterion.id]) next[criterion.id] = { score: '', comment: '' };
          }
          return next;
        });
      } catch (caught) {
        if (active) setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить критерии.');
      }
    })();
    return () => {
      active = false;
    };
  }, [stage]);

  const loadEvaluations = useCallback(async () => {
    if (teamId === '') {
      setEvaluations([]);
      return;
    }
    try {
      setEvaluations(await adminApi.evaluations({ stage, team_id: Number(teamId) }));
    } catch {
      setEvaluations([]);
    }
  }, [stage, teamId]);

  useEffect(() => {
    void loadEvaluations();
  }, [loadEvaluations]);

  const total = useMemo(
    () =>
      criteria.reduce((sum, criterion) => {
        const raw = scores[criterion.id]?.score ?? '';
        const value = Number(raw);
        return Number.isFinite(value) && raw !== '' ? sum + value : sum;
      }, 0),
    [criteria, scores]
  );

  const maxTotal = useMemo(
    () => criteria.reduce((sum, criterion) => sum + Number(criterion.max_score), 0),
    [criteria]
  );

  const expertName = (evaluation: Evaluation) => {
    if (evaluation.expert_id !== null) {
      return experts.find((expert) => expert.id === evaluation.expert_id)?.full_name ?? `Эксперт ${evaluation.expert_id}`;
    }
    return `Член Жюри ${evaluation.jury_member_id ?? ''}`;
  };

  async function issueExpertAccess() {
    setExpertAccessBusy(true);
    setError(null);
    setNotice(null);
    setExpertAccessUrl(null);
    try {
      const result = await adminApi.issueExpertAccess(Number(expertAccessId), {
        expires_in_days: Number(expertAccessDays),
      });
      setExpertAccessUrl(result.access_url);
      setExpertAccessInfo(
        result.revoked_previous > 0
          ? `Прежних ссылок отозвано: ${result.revoked_previous}. Новая действует до ${formatMoscowHuman(result.expires_at)}.`
          : `Ссылка действует до ${formatMoscowHuman(result.expires_at)}.`
      );
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось выдать доступ эксперту.');
    } finally {
      setExpertAccessBusy(false);
    }
  }

  async function revokeExpertAccess() {
    setExpertAccessBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.revokeExpertAccess(Number(expertAccessId));
      setExpertAccessUrl(null);
      setExpertAccessInfo(
        result.revoked > 0
          ? `Отозвано ссылок: ${result.revoked}. Эксперт больше не сможет войти.`
          : 'У эксперта не было действующих ссылок.'
      );
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось отозвать доступ эксперта.');
    } finally {
      setExpertAccessBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payloadScores = criteria
        .map((criterion) => ({
          criterion_id: criterion.id,
          score: Number(scores[criterion.id]?.score ?? ''),
          comment: (scores[criterion.id]?.comment ?? '').trim() || null,
        }))
        .filter((item) => Number.isFinite(item.score));

      if (payloadScores.length !== criteria.length) {
        setError('Заполните балл по каждому критерию: оценочный лист должен быть полным.');
        return;
      }

      await adminApi.saveEvaluation({
        team_id: Number(teamId),
        stage,
        expert_id: Number(expertId),
        scores: payloadScores,
        comment: comment.trim() || null,
        recommendations: recommendations.trim() || null,
        is_conflicted: isConflicted,
        conflict_reason: isConflicted ? conflictReason.trim() || null : null,
      });
      setNotice('Оценка сохранена. Итог по этапу считается как среднее арифметическое сумм баллов.');
      setComment('');
      setRecommendations('');
      await loadEvaluations();
      // Матрица «команда × эксперт» показывает прогресс: после сохранения её
      // нужно обновить, иначе счётчик оценок отстаёт от факта.
      if (matrixSeasonId !== null) {
        try {
          setMatrix(await adminApi.evaluationMatrix(matrixSeasonId, stage));
        } catch {
          // Ошибка обновления матрицы не отменяет сохранённую оценку.
        }
      }
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось сохранить оценку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Оценочный лист · Приложение № 9"
        title="Оценка конкурсных материалов"
        lead="Каждую инициативу оценивают члены Конкурсной комиссии. Итог этапа — среднее арифметическое сумм баллов с округлением до сотых."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {matrix && matrix.rows.length > 0 ? (
        <SectionCard
          title="Матрица «команда × эксперт»"
          description="Оценки по каждой работе; оценки с конфликтом интересов в подсчёт не входят."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only-text">Прогресс оценивания работ этапа</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">
                    Работа
                  </th>
                  {matrix.experts.map((expert) => (
                    <th key={expert.id} scope="col" className="py-2 pr-4">
                      {expert.full_name}
                    </th>
                  ))}
                  <th scope="col" className="py-2">
                    Готовность
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.team_id} className="border-b border-border align-top">
                    <td className="py-2 pr-4">
                      {row.team_name}
                      {row.direction_title ? <span className="text-muted"> — {row.direction_title}</span> : null}
                    </td>
                    {row.cells.map((cell) => (
                      <td key={`${row.team_id}-${cell.expert_id}`} className="py-2 pr-4">
                        {cell.filled ? (
                          <span className={cell.is_conflicted ? 'text-warning' : 'text-success'}>
                            {cell.is_conflicted
                              ? 'конфликт интересов'
                              : `✓ ${Number(cell.total_score ?? 0).toFixed(2)}`}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    ))}
                    <td className="py-2">
                      <span className={row.is_ready ? 'text-success' : 'text-muted'}>
                        {row.evaluations_count === 0 ? 'оценок нет' : `оценок: ${row.evaluations_count}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Доступ эксперта к внесению оценок"
        description="Разовая ссылка: эксперт входит по ней, видит работы своего этапа и вносит оценки. Учётная запись в админке ему не нужна."
      >
        <div className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
          <SelectField
            id="expert-access-expert"
            label="Эксперт"
            value={expertAccessId}
            onChange={(event) => {
              const value = event.target.value;
              setExpertAccessId(value);
              setExpertAccessUrl(null);
              setExpertAccessInfo(null);
              setExpertAccessHistory(null);
              if (value !== '') {
                void adminApi
                  .expertAccess(Number(value))
                  .then(setExpertAccessHistory)
                  .catch(() => undefined);
              }
            }}
            placeholder="Выберите эксперта"
            options={experts.map((expert) => ({ value: String(expert.id), title: expert.full_name }))}
          />
          <SelectField
            id="expert-access-days"
            label="Срок действия"
            value={expertAccessDays}
            onChange={(event) => setExpertAccessDays(event.target.value)}
            options={[
              { value: '7', title: '7 дней' },
              { value: '14', title: '14 дней' },
              { value: '30', title: '30 дней' },
              { value: '90', title: '90 дней' },
            ]}
          />
          <div className="flex flex-wrap items-end gap-3">
            <Button
              type="button"
              loading={expertAccessBusy}
              disabled={expertAccessId === ''}
              onClick={() => void issueExpertAccess()}
            >
              Выдать ссылку
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={expertAccessBusy}
              disabled={expertAccessId === ''}
              onClick={() => void revokeExpertAccess()}
            >
              Отозвать доступ
            </Button>
          </div>
        </div>
        {expertAccessInfo ? <p className="mt-3 text-sm text-muted">{expertAccessInfo}</p> : null}

        {expertAccessHistory && expertAccessHistory.tokens.length > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mono-label text-muted">История доступов эксперта</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <caption className="sr-only-text">Выданные ссылки доступа эксперта</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th scope="col" className="py-2 pr-4">Выдана</th>
                    <th scope="col" className="py-2 pr-4">Действует до</th>
                    <th scope="col" className="py-2 pr-4">Открытий</th>
                    <th scope="col" className="py-2">Состояние</th>
                  </tr>
                </thead>
                <tbody>
                  {expertAccessHistory.tokens.map((token) => {
                    const expired = new Date(token.expires_at).getTime() < Date.now();
                    const state = token.revoked_at ? 'отозвана' : expired ? 'истекла' : 'действует';
                    return (
                      <tr key={token.id} className="border-b border-border">
                        <td className="py-2 pr-4">{formatMoscowHuman(token.created_at ?? token.expires_at)}</td>
                        <td className="py-2 pr-4">{formatMoscowHuman(token.expires_at)}</td>
                        <td className="py-2 pr-4">
                          {token.used_count}
                          {token.last_used_at ? ` (последний раз ${formatMoscowHuman(token.last_used_at)})` : ''}
                        </td>
                        <td className="py-2">{state}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {expertAccessHistory.log.length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Обращений в контуре эксперта: {expertAccessHistory.log.length}; последнее —{' '}
                {formatMoscowHuman(expertAccessHistory.log[0]?.created_at)}.
              </p>
            ) : null}
          </div>
        ) : null}
        {expertAccessUrl ? (
          <div className="mt-4 border border-border-strong p-4">
            <p className="mono-label text-muted">Ссылка для эксперта</p>
            <p className="mt-2 break-all font-mono text-sm">{expertAccessUrl}</p>
            <p className="mt-3 text-sm text-muted">
              Передайте ссылку эксперту: при входе она меняется на сессию и исчезает из адресной строки. Повторная выдача
              отзывает прежнюю ссылку.
            </p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Кто и что оценивает">
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            id="evaluation-stage"
            label="Этап"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            options={EVALUATION_STAGES.map((item) => ({ value: item.value, title: item.title }))}
          />
          <SelectField
            id="evaluation-team"
            label="Команда"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            placeholder="Выберите команду"
            options={teams.map((team) => ({ value: team.id, title: team.name }))}
          />
          <SelectField
            id="evaluation-expert"
            label="Член комиссии"
            value={expertId}
            onChange={(event) => setExpertId(event.target.value)}
            placeholder="Выберите эксперта"
            options={experts.map((expert) => ({
              value: expert.id,
              title: `${expert.full_name}${expert.role === 'chair' ? ' (председатель)' : ''}`,
            }))}
            hint={experts.length === 0 ? 'На этом этапе эксперты не заведены: добавьте их в справочнике.' : undefined}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={`Критерии этапа «${evaluationStageTitle(stage)}»`}
        description={`Максимум по этапу: ${maxTotal} баллов. Итог: ${total}.`}
      >
        <div className="flex flex-col gap-6">
          {criteria.map((criterion, index) => (
            <div key={criterion.id} className="border-b border-border pb-4">
              <p className="font-medium">
                {index + 1}. {criterion.title}
              </p>
              <p className="text-sm text-muted">Максимум: {Number(criterion.max_score)} баллов</p>
              <div className="mt-3 grid gap-4 md:grid-cols-[120px,1fr]">
                <TextField
                  id={`criterion-score-${criterion.id}`}
                  label="Балл"
                  type="number"
                  min={0}
                  max={Number(criterion.max_score)}
                  value={scores[criterion.id]?.score ?? ''}
                  onChange={(event) =>
                    setScores((current) => ({
                      ...current,
                      [criterion.id]: { score: event.target.value, comment: current[criterion.id]?.comment ?? '' },
                    }))
                  }
                />
                <TextAreaField
                  id={`criterion-comment-${criterion.id}`}
                  label="Обоснование"
                  value={scores[criterion.id]?.comment ?? ''}
                  onChange={(event) =>
                    setScores((current) => ({
                      ...current,
                      [criterion.id]: { score: current[criterion.id]?.score ?? '', comment: event.target.value },
                    }))
                  }
                  maxLength={1000}
                />
              </div>
            </div>
          ))}
          {criteria.length === 0 ? <p className="text-sm text-muted">Для этого этапа критерии не заданы.</p> : null}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <TextAreaField
            id="evaluation-comment"
            label="Общий комментарий по инициативе"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={3000}
          />
          <TextAreaField
            id="evaluation-recommendations"
            label="Рекомендации команде"
            value={recommendations}
            onChange={(event) => setRecommendations(event.target.value)}
            maxLength={3000}
            hint="Формулировки из оценочного листа Приложения № 9."
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={isConflicted}
                onChange={(event) => setIsConflicted(event.target.checked)}
              />
              <span>
                Конфликт интересов: оценка сохраняется для истории, но не учитывается в рейтинге
              </span>
            </label>
            {isConflicted ? (
              <TextField
                id="conflict-reason"
                label="Причина конфликта интересов"
                value={conflictReason}
                onChange={(event) => setConflictReason(event.target.value)}
                hint="Например: близкий родственник среди участников команды."
                required
              />
            ) : null}
            <Button
              loading={busy}
              disabled={
                teamId === '' || expertId === '' || criteria.length === 0 || (isConflicted && conflictReason.trim().length < 3)
              }
              onClick={() => void save()}
            >
              Сохранить оценку
            </Button>
            <span className="text-sm text-muted">
              Итог по листу: {total} из {maxTotal}.
            </span>
          </div>
        </div>
      </SectionCard>

      {teamId !== '' ? (
        <SectionCard title={`Уже выставленные оценки (${evaluations.length})`} description="Повторная оценка тем же членом комиссии заменяет прежнюю.">
          {evaluations.length === 0 ? (
            <p className="text-sm text-muted">По этой команде на этапе оценок пока нет.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {evaluations.map((evaluation) => (
                <li key={evaluation.id} className="border-b border-border pb-3">
                  <p>
                    {expertName(evaluation)} · итог {Number(evaluation.total_score)}
                    {evaluation.is_chair_extra ? ' · оценка председателя' : ''}
                  </p>
                  {evaluation.recommendations ? <p className="text-muted">Рекомендации: {evaluation.recommendations}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}
    </main>
  );
}
