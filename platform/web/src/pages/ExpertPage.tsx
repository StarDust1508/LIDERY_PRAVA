import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, expertApi, type ExpertAssignment } from '@shared/index';
import { Alert, Button, SectionCard, SelectField, TextAreaField, TextField } from '@shared/index';
import { PageHeader } from '@/components/PageBlocks';

// Рабочее место эксперта (ТЗ 07, п. 2.5).
//
// Эксперт входит по разовой ссылке от Оргкомитета и вносит оценки по критериям
// своего этапа. Контур отдельный: ни админки, ни кабинета команд он не открывает,
// персональные данные участников здесь не показываются — только работа и её
// сведения, необходимые для оценки по Приложению № 9.
//
// Если в адресе есть токен, он обменивается на сессию сразу, а токен убирается
// из адресной строки.

interface ScoreDraft {
  [criterionId: number]: { score: string; comment: string };
}

export function ExpertPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expert, setExpert] = useState<{ id: number; full_name: string; stage: string } | null>(null);
  const [criteria, setCriteria] = useState<Array<{ id: number; title: string; max_score: number; description: string | null }>>([]);
  const [teams, setTeams] = useState<ExpertAssignment[]>([]);
  const [teamId, setTeamId] = useState('');
  const [scores, setScores] = useState<ScoreDraft>({});
  const [comment, setComment] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [isConflicted, setIsConflicted] = useState(false);
  const [conflictReason, setConflictReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await expertApi.assignments();
      setExpert(data.expert);
      setCriteria(data.criteria);
      setTeams(data.teams);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setExpert(null);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить работы этапа.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Обмен ссылки на сессию: токен уходит из адресной строки сразу.
  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      void load();
      return;
    }
    let active = true;
    void (async () => {
      try {
        await expertApi.accessByToken(token.trim());
        if (active) {
          setSearchParams({}, { replace: true });
          await load();
        }
      } catch (caught) {
        if (active) {
          setSearchParams({}, { replace: true });
          setError(
            caught instanceof ApiError
              ? caught.message
              : 'Ссылка не подошла. Запросите новую у Оргкомитета.'
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fillFromTeam(id: string) {
    setTeamId(id);
    setNotice(null);
    const team = teams.find((row) => String(row.team_id) === id);
    const stored = team?.scores ?? null;
    const next: ScoreDraft = {};
    for (const criterion of criteria) {
      const existing = stored?.find((item) => Number(item.criterion_id) === criterion.id);
      next[criterion.id] = {
        score: existing ? String(existing.score) : '',
        comment: existing?.comment ?? '',
      };
    }
    setScores(next);
    setComment(team?.comment ?? '');
    setRecommendations(team?.recommendations ?? '');
    setIsConflicted(team?.is_conflicted === true);
    setConflictReason(team?.conflict_reason ?? '');
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = criteria.map((criterion) => ({
        criterion_id: criterion.id,
        score: Number(scores[criterion.id]?.score ?? 0),
        comment: scores[criterion.id]?.comment?.trim() || null,
      }));
      const result = await expertApi.saveEvaluation({
        team_id: Number(teamId),
        scores: payload,
        comment: comment.trim() || null,
        recommendations: recommendations.trim() || null,
        is_conflicted: isConflicted,
        conflict_reason: isConflicted ? conflictReason.trim() || null : null,
      });
      setNotice(`Оценка сохранена: ${Number(result.total_score).toFixed(2)} балла.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось сохранить оценку.');
    } finally {
      setBusy(false);
    }
  }

  const selected = teams.find((row) => String(row.team_id) === teamId);
  const totalSum = criteria.reduce((sum, criterion) => sum + Number(scores[criterion.id]?.score || 0), 0);
  const maxSum = criteria.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <p role="status" className="loading-note">
          Загружаем работы этапа…
        </p>
      </main>
    );
  }

  if (!expert) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <PageHeader eyebrow="Экспертиза" title="Доступ эксперта" />
        <SectionCard title="Вход по ссылке" description="Ссылку выдаёт Оргкомитет конкурса.">
          {error ? <Alert tone="danger" title="Вход не выполнен">{error}</Alert> : null}
          <p className="mt-4 text-sm text-muted">
            Откройте ссылку из письма или сообщения Оргкомитета — она открывает эту страницу и подтверждает доступ.
          </p>
        </SectionCard>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Экспертиза"
        title={expert.full_name}
        lead={`Этап: ${expert.stage}. Доступ выдан Оргкомитетом; оценки сохраняются в системе конкурса.`}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void expertApi.logout().finally(() => navigate('/', { replace: true }));
            }}
          >
            Выйти
          </Button>
        }
      />

      {error ? <Alert tone="danger" title="Не удалось выполнить">{error}</Alert> : null}
      {notice ? <Alert tone="success" title="Готово">{notice}</Alert> : null}

      <SectionCard title="Работа" description="Выберите работу из списка — оценки и обоснования сохраняются отдельно по каждой.">
        <SelectField
          id="expert-team"
          label="Работа"
          value={teamId}
          onChange={(event) => fillFromTeam(event.target.value)}
          placeholder="Выберите работу"
          options={teams.map((row) => ({
            value: String(row.team_id),
            title: `${row.team_name}${row.law_title ? ` — ${row.law_title}` : ''}`,
          }))}
        />
        {selected ? (
          <div className="mt-4 text-sm text-muted">
            <p>Направление: {selected.direction_title ?? 'не указано'}</p>
            <p>Уровень акта: {selected.act_level ?? 'не указан'}</p>
            {selected.annotation ? <p className="mt-2">{selected.annotation}</p> : null}
            {selected.evaluation_id ? (
              <p className="mt-2">
                Оценка уже внесена: {Number(selected.total_score ?? 0).toFixed(2)} балла. Изменения сохраняются поверх.
              </p>
            ) : (
              <p className="mt-2">Оценка по этой работе ещё не внесена.</p>
            )}
          </div>
        ) : null}
      </SectionCard>

      {teamId !== '' && criteria.length > 0 ? (
        <SectionCard
          title="Оценка по критериям"
          description={`Сумма: ${totalSum.toFixed(2)} из ${maxSum.toFixed(2)}. По каждому критерию — балл и обоснование (Приложение № 9).`}
        >
          <div className="flex flex-col gap-5">
            {criteria.map((criterion) => (
              <div key={criterion.id} className="grid gap-3 border-b border-border pb-4 md:grid-cols-[1fr_160px]">
                <div>
                  <p className="font-semibold">{criterion.title}</p>
                  {criterion.description ? <p className="text-sm text-muted">{criterion.description}</p> : null}
                  <TextField
                    id={`criterion-comment-${criterion.id}`}
                    label="Обоснование"
                    value={scores[criterion.id]?.comment ?? ''}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [criterion.id]: { score: current[criterion.id]?.score ?? '', comment: event.target.value },
                      }))
                    }
                  />
                </div>
                <TextField
                  id={`criterion-score-${criterion.id}`}
                  label={`Балл (0–${criterion.max_score})`}
                  type="number"
                  value={scores[criterion.id]?.score ?? ''}
                  onChange={(event) =>
                    setScores((current) => ({
                      ...current,
                      [criterion.id]: { score: event.target.value, comment: current[criterion.id]?.comment ?? '' },
                    }))
                  }
                />
              </div>
            ))}

            <TextAreaField
              id="expert-comment"
              label="Комментарий к работе"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <TextAreaField
              id="expert-recommendations"
              label="Рекомендации команде"
              value={recommendations}
              onChange={(event) => setRecommendations(event.target.value)}
            />

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={isConflicted}
                onChange={(event) => setIsConflicted(event.target.checked)}
              />
              <span>Конфликт интересов: оценка сохранится, но не будет учитываться в рейтинге</span>
            </label>
            {isConflicted ? (
              <TextField
                id="expert-conflict-reason"
                label="Причина конфликта интересов"
                value={conflictReason}
                onChange={(event) => setConflictReason(event.target.value)}
                required
              />
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                loading={busy}
                disabled={isConflicted && conflictReason.trim().length < 3}
                onClick={() => void save()}
              >
                Сохранить оценку
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </main>
  );
}
