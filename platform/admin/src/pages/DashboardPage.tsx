import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AdminApiError,
  type AdminStats,
  type AuditRecord,
  adminApi,
  evaluationStageTitle,
  formatMoscowHuman,
  MATERIAL_STATUS_TITLES,
  pluralize,
  TECH_STATUS_TITLES,
  teamStatusTitle,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField } from '@shared/index';

// Сводка сезона (ТЗ 07, п. 2.1): только то, что требует решения.
//
// Декоративных графиков здесь нет намеренно: каждый блок показывает число и
// ведёт в список. Счётчики внимания (п. 1.7) продублированы в меню, но на
// сводке стоят крупными ссылками, чтобы очередь можно было разобрать сразу.
//
// Данные: /api/admin/stats по выбранному сезону, /api/admin/seasons — выбор
// сезона (по умолчанию активный), /api/admin/audit — последние действия.

type Season = { id: number; slug: string; title: string; year: number; is_active: boolean };

const LEAD_STATUS_TITLES: Record<string, string> = {
  new: 'Новое',
  in_progress: 'В работе',
  answered: 'Отвечено',
  closed: 'Закрыто',
  spam: 'Спам',
};

/** Подписи сущностей журнала — те же, что в разделе «Журнал действий». */
const ENTITY_TITLES: Record<string, string> = {
  applications: 'Заявки',
  materials: 'Материалы',
  teams: 'Команды',
  appeals: 'Апелляции',
  leads: 'Обращения',
  settings: 'Настройки',
  rankings: 'Рейтинг',
  evaluations: 'Оценки',
  participants: 'Участники',
  users: 'Пользователи',
  auth: 'Вход в админ-панель',
};

/** Статусы заявки, которые сервер считает необработанными (п. 1.7). */
const APPLICATION_ATTENTION_STATUSES = ['pending', 'in_review'];

/** Ошибка объясняет, что делать (ТЗ 07, п. 3.5). */
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

export function DashboardPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [seasonsReady, setSeasonsReady] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Сезоны загружаются один раз: по умолчанию открывается активный сезон.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await adminApi.seasons();
        if (!active) return;
        setSeasons(list);
        setSeasonId(list.find((season) => season.is_active)?.id ?? list[0]?.id ?? null);
      } catch {
        // Выбор сезона — вспомогательный блок: сводка показывается по всем данным.
      } finally {
        if (active) setSeasonsReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, auditData] = await Promise.all([
        adminApi.stats(seasonId === null ? {} : { season_id: seasonId }),
        adminApi.audits({ limit: 10 }),
      ]);
      setStats(statsData);
      setAudits(auditData);
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить сводку.'));
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    if (!seasonsReady) return;
    void load();
  }, [seasonsReady, load]);

  const attention = stats?.attention ?? {
    applications_pending: 0,
    materials_needs_fix: 0,
    appeals_open: 0,
    leads_new: 0,
  };

  const applicationsByStatus = stats?.applications_by_status ?? [];
  const applicationsTotal = applicationsByStatus.reduce((sum, row) => sum + row.count, 0);
  const pendingApplications = applicationsByStatus
    .filter((row) => APPLICATION_ATTENTION_STATUSES.includes(row.tech_status))
    .reduce((sum, row) => sum + row.count, 0);

  const materialsByStatus = stats?.materials_by_status ?? [];
  const materialsTotal = materialsByStatus.reduce((sum, row) => sum + row.count, 0);
  const materialsAccepted = materialsByStatus.find((row) => row.status === 'accepted')?.count ?? 0;

  const teamsByStatus = stats?.teams_by_status ?? [];
  const teamsTotal = teamsByStatus.reduce((sum, row) => sum + row.count, 0);

  const rankingsByStage = stats?.rankings_by_stage ?? [];
  const chairReviews = rankingsByStage.reduce((sum, row) => sum + row.needs_chair_review, 0);
  const leadsByStatus = stats?.leads_by_status ?? [];

  const isEmpty =
    !loading &&
    stats !== null &&
    applicationsTotal === 0 &&
    materialsTotal === 0 &&
    teamsTotal === 0 &&
    rankingsByStage.length === 0 &&
    leadsByStatus.length === 0;

  const selectedSeason = seasons.find((season) => season.id === seasonId) ?? null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Сводка сезона"
        title="Сводка"
        lead="Собрано только то, что требует решения: очереди проверки и ответов, состояние этапов и последние действия Оргкомитета."
        aside={
          <div className="flex flex-wrap items-end gap-3">
            {seasons.length > 0 ? (
              <div className="w-64">
                <SelectField
                  id="dashboard-season"
                  label="Сезон"
                  value={seasonId === null ? '' : String(seasonId)}
                  options={seasons.map((season) => ({
                    value: String(season.id),
                    title: `${season.title} (${season.year})${season.is_active ? ' — активный' : ''}`,
                  }))}
                  onChange={(event) => setSeasonId(Number(event.target.value))}
                />
              </div>
            ) : null}
            <Button variant="secondary" onClick={() => void load()} loading={loading}>
              Обновить
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert tone="danger" title="Не удалось показать сводку">
          {error}
        </Alert>
      ) : null}

      {loading && stats === null ? <p role="status">Загружаем сводку…</p> : null}

      {isEmpty ? (
        <Alert tone="info" title="За сезон пока нет данных">
          Заявки появятся здесь после первой подачи через форму на сайте, конкурсные материалы — после загрузки их
          командой в личном кабинете. Если данные уже есть, проверьте, что выбран нужный сезон.
        </Alert>
      ) : null}

      {stats !== null ? (
        <>
          <SectionCard
            title="Требует решения"
            description={
              selectedSeason
                ? `Очереди по сезону «${selectedSeason.title}». Каждая ссылка открывает соответствующий список.`
                : 'Очереди по всем данным панели. Каждая ссылка открывает соответствующий список.'
            }
          >
            <ul className="grid gap-4 md:grid-cols-2">
              <li>
                <Link
                  to="/applications"
                  className="flex h-full flex-col gap-1 border border-border px-5 py-4 hover:border-accent"
                >
                  <span className="mono-label text-muted">Необработанные заявки</span>
                  <span className="text-h3 font-semibold">{attention.applications_pending}</span>
                  <span className="text-sm text-muted">
                    Ожидают технической проверки и находятся в работе. Фильтр по статусу выбирается в разделе «Заявки».
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  to="/materials?status=needs_fix"
                  className="flex h-full flex-col gap-1 border border-border px-5 py-4 hover:border-accent"
                >
                  <span className="mono-label text-muted">Материалы с замечаниями</span>
                  <span className="text-h3 font-semibold">{attention.materials_needs_fix}</span>
                  <span className="text-sm text-muted">
                    Возвращены на доработку: у каждого замечания есть срок досдачи — не более двух рабочих дней.
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  to="/appeals?term=open"
                  className="flex h-full flex-col gap-1 border border-border px-5 py-4 hover:border-accent"
                >
                  <span className="mono-label text-muted">Апелляции в сроке</span>
                  <span className="text-h3 font-semibold">{attention.appeals_open}</span>
                  <span className="text-sm text-muted">
                    Решение не принято, срок рассмотрения не истёк. Срок рассмотрения — пять рабочих дней.
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  to="/leads?status=new"
                  className="flex h-full flex-col gap-1 border border-border px-5 py-4 hover:border-accent"
                >
                  <span className="mono-label text-muted">Обращения без ответа</span>
                  <span className="text-h3 font-semibold">{attention.leads_new}</span>
                  <span className="text-sm text-muted">
                    Новые обращения с формы на сайте и из личного кабинета команды.
                  </span>
                </Link>
              </li>
            </ul>
          </SectionCard>

          <SectionCard
            title="Заявки по статусам технической проверки"
            description={`Всего в выборке: ${pluralize(applicationsTotal, ['заявка', 'заявки', 'заявок'])}; необработанных: ${pendingApplications}.`}
            actions={
              <Link
                to="/applications"
                className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
              >
                Открыть заявки
              </Link>
            }
          >
            {applicationsByStatus.length === 0 ? (
              <p className="text-sm text-muted">
                Заявок пока нет. Они появятся здесь после первой подачи через форму на сайте.
              </p>
            ) : (
              <ul className="flex flex-col">
                {applicationsByStatus.map((row) => (
                  <li
                    key={row.tech_status}
                    className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
                  >
                    <span>{TECH_STATUS_TITLES[row.tech_status] ?? row.tech_status}</span>
                    <span className="flex items-center gap-4">
                      <span className="mono-label text-muted">
                        {row.count} из {applicationsTotal}
                      </span>
                      <span className="mono-label text-accent">{row.count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Комплектность конкурсных материалов"
            description={`Всего конкурсных материалов: ${materialsTotal}; принято: ${materialsAccepted}. Полнота комплекта по каждой команде («7 из 7») видна в карточке заявки.`}
            actions={
              <Link
                to="/materials"
                className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
              >
                Открыть материалы
              </Link>
            }
          >
            {materialsByStatus.length === 0 ? (
              <p className="text-sm text-muted">
                Конкурсные материалы не загружены. Они появятся после того, как команды заполнят комплект в личном
                кабинете.
              </p>
            ) : (
              <ul className="flex flex-col">
                {materialsByStatus.map((row) => (
                  <li key={row.status} className="border-b border-border last:border-b-0">
                    <Link
                      to={`/materials?status=${encodeURIComponent(row.status)}`}
                      className="flex items-center justify-between gap-4 py-3 hover:text-accent"
                    >
                      <span>{MATERIAL_STATUS_TITLES[row.status] ?? row.status}</span>
                      <span className="flex items-center gap-4">
                        <span className="mono-label text-muted">
                          {row.count} из {materialsTotal}
                        </span>
                        <span className="mono-label text-accent">{row.count}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Команды по этапам и статусам"
            description={`Всего команд: ${teamsTotal}. Состав, доступы в личный кабинет и ссылка на карточку заявки — в разделе «Команды».`}
            actions={
              <Link
                to="/teams"
                className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
              >
                Открыть команды
              </Link>
            }
          >
            {teamsByStatus.length === 0 ? (
              <p className="text-sm text-muted">Команд пока нет. Они появятся здесь после первой заявки.</p>
            ) : (
              <ul className="flex flex-col">
                {teamsByStatus.map((row) => (
                  <li key={row.status} className="border-b border-border last:border-b-0">
                    <Link
                      to={`/teams?status=${encodeURIComponent(row.status)}`}
                      className="flex items-center justify-between gap-4 py-3 hover:text-accent"
                    >
                      <span>{teamStatusTitle(row.status)}</span>
                      <span className="flex items-center gap-4">
                        <span className="mono-label text-muted">
                          {row.count} из {teamsTotal}
                        </span>
                        <span className="mono-label text-accent">{row.count}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Рейтинг по этапам"
            description="Строки рейтинга считаются по внесённым оценкам. Если суммы оценок расходятся более чем на 20 баллов, команде нужна дополнительная оценка председателя — без неё протокол не публикуется."
            actions={
              <Link
                to="/rankings"
                className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
              >
                Открыть рейтинг
              </Link>
            }
          >
            {rankingsByStage.length === 0 ? (
              <p className="text-sm text-muted">
                Рейтинг ещё не рассчитан. Таблица появится после того, как Конкурсная комиссия внесёт оценки, а
                Оргкомитет нажмёт «Рассчитать рейтинг».
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {chairReviews > 0 ? (
                  <Alert tone="warning" title="Публикация протокола приостановлена">
                    Команд, ожидающих дополнительной оценки председателя: {chairReviews}. Протокол нельзя опубликовать,
                    пока оценка не внесена (п. 7.7 Положения).
                  </Alert>
                ) : null}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only-text">Рейтинг по этапам: команды и ожидающие оценки</caption>
                    <thead>
                      <tr className="border-b border-border-strong text-left">
                        <th scope="col" className="py-2 pr-4">
                          Этап
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Команд в рейтинге
                        </th>
                        <th scope="col" className="py-2">
                          Ждут оценки председателя
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingsByStage.map((row) => (
                        <tr key={row.stage} className="border-b border-border">
                          <td className="py-2 pr-4">{evaluationStageTitle(row.stage)}</td>
                          <td className="py-2 pr-4">{row.count}</td>
                          <td className="py-2">
                            {row.needs_chair_review > 0 ? (
                              <span className="text-warning">{row.needs_chair_review}</span>
                            ) : (
                              'нет'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="flex flex-col gap-3 md:hidden">
                  {rankingsByStage.map((row) => (
                    <li key={`card-${row.stage}`} className="border border-border p-4 text-sm">
                      <p className="font-semibold">{evaluationStageTitle(row.stage)}</p>
                      <p className="mt-1 text-muted">Команд в рейтинге: {row.count}</p>
                      <p className="mt-1 text-muted">
                        Ждут оценки председателя: {row.needs_chair_review > 0 ? row.needs_chair_review : 'нет'}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Последние действия администраторов"
            description="Новые сверху. В журнале — автор, время, объект и результат каждого изменения."
            actions={
              <Link
                to="/audit"
                className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
              >
                Открыть журнал
              </Link>
            }
          >
            {audits.length === 0 ? (
              <p className="text-sm text-muted">Записей нет. Журнал заполняется, когда администратор меняет данные.</p>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only-text">Последние действия администраторов</caption>
                    <thead>
                      <tr className="border-b border-border-strong text-left">
                        <th scope="col" className="py-2 pr-4">
                          Когда
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Кто
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Действие
                        </th>
                        <th scope="col" className="py-2">
                          Объект
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {audits.map((record) => (
                        <tr key={record.id} className="border-b border-border align-top">
                          <td className="py-2 pr-4">{formatMoscowHuman(record.created_at)}</td>
                          <td className="py-2 pr-4">{record.user_name ?? record.actor_label ?? record.actor_type}</td>
                          <td className="py-2 pr-4 font-mono">{record.action}</td>
                          <td className="py-2">
                            {ENTITY_TITLES[record.entity] ?? record.entity}
                            {record.entity_id ? ` № ${record.entity_id}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="flex flex-col gap-3 md:hidden">
                  {audits.map((record) => (
                    <li key={`card-${record.id}`} className="border border-border p-4 text-sm">
                      <p className="mono-label text-muted">{formatMoscowHuman(record.created_at)}</p>
                      <p className="mt-1 font-mono">{record.action}</p>
                      <p className="mt-1">
                        {ENTITY_TITLES[record.entity] ?? record.entity}
                        {record.entity_id ? ` № ${record.entity_id}` : ''}
                      </p>
                      <p className="mt-1 text-muted">{record.user_name ?? record.actor_label ?? record.actor_type}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </SectionCard>

          {leadsByStatus.length > 0 ? (
            <SectionCard title="Обращения по статусам" description="Очередь ответов Оргкомитета.">
              <ul className="flex flex-col">
                {leadsByStatus.map((row) => (
                  <li key={row.status} className="border-b border-border last:border-b-0">
                    <Link
                      to={`/leads?status=${encodeURIComponent(row.status)}`}
                      className="flex items-center justify-between gap-4 py-3 hover:text-accent"
                    >
                      <span>{LEAD_STATUS_TITLES[row.status] ?? row.status}</span>
                      <span className="mono-label text-accent">{row.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
