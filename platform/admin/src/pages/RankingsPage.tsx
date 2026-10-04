import { useCallback, useEffect, useState } from 'react';
import {
  AdminApiError,
  EVALUATION_STAGES,
  type Ranking,
  adminApi,
  evaluationStageTitle,
  formatMoscowHuman,
  teamStatusTitle,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField } from '@shared/index';

// Рейтинг этапа: расчёт по пункту 7.7 (среднее арифметическое сумм членов
// комиссии, расхождение более 20 баллов — на дополнительную оценку председателя)
// и публикация протокола. Публикация — единственный способ показать баллы
// участникам и точка отсчёта срока апелляции (п. 12.1).

export function RankingsPage() {
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
              disabled={seasonId === '' || rows.length === 0}
              onClick={() =>
                void run(async () => {
                  const result = await adminApi.publishRankings(Number(seasonId), stage);
                  return result.message ?? `Опубликовано записей: ${result.published}.`;
                })
              }
            >
              Опубликовать протокол
            </Button>
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

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
          <div className="overflow-x-auto">
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
                        <span className="text-warning">нужна доп. оценка председателя</span>
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
        )}
      </SectionCard>
    </main>
  );
}
