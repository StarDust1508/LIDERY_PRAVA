import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AdminApiError,
  type Criterion,
  EVALUATION_STAGES,
  type Evaluation,
  type Expert,
  adminApi,
  evaluationStageTitle,
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [criteriaData, expertsData, teamsData] = await Promise.all([
          adminApi.criteria(stage),
          adminApi.experts(),
          adminApi.teams(),
        ]);
        if (!active) return;
        setCriteria(criteriaData);
        setExperts(expertsData.filter((expert) => expert.stage === stage && expert.is_active));
        setTeams(teamsData);
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
      });
      setNotice('Оценка сохранена. Итог по этапу считается по пункту 7.7 Положения.');
      setComment('');
      setRecommendations('');
      await loadEvaluations();
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
        lead="Каждую инициативу оценивают не менее трёх членов комиссии независимо друг от друга (п. 5.2.3, 7.6). Итог этапа — среднее арифметическое сумм с округлением до сотых (п. 7.7)."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

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
            <Button loading={busy} disabled={teamId === '' || expertId === '' || criteria.length === 0} onClick={() => void save()}>
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
                    {evaluation.is_chair_extra ? ' · дополнительная оценка председателя' : ''}
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
