import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AdminApiError,
  adminApi,
  formatMoscowHuman,
  TEAM_STATUS_TITLES,
  teamStatusTitle,
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
import type { AdminApplicationRow } from '@shared/index';

// Команды сезона и доступы в личный кабинет (ТЗ 07, п. 2.4–2.5).
//
// Статус команды меняется здесь решением Оргкомитета: перевод на этап,
// дисквалификация с обязательной причиной и восстановление. Решение попадает в
// журнал действий и видно в карточке команды. Показаны статус, ссылка на
// карточку заявки и работа с
// доступами. Статус и участники приходят из GET /api/admin/teams.
//
// Доступ выдаётся токеном: сервер возвращает ссылку один раз, в базе хранится
// только её хеш, поэтому ссылка показывается однократно и с предупреждением.

type Season = { id: number; slug: string; title: string; year: number; is_active: boolean };

/** Строка команды: поля совпадают с ответом GET /api/admin/teams. */
interface TeamRow {
  /** Причина дисквалификации: показывается рядом со статусом (ТЗ 07, п. 2.4). */
  disqualification_reason?: string | null;
  id: number;
  season_id: number;
  name: string;
  status: string;
  organization: string | null;
  city: string | null;
  direction_title: string | null;
  participants_count: number;
  mentors_count: number;
  materials_count: number;
  captain_name: string | null;
  created_at: string;
}

interface TeamToken {
  id: number;
  label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_count: number;
  max_uses: number;
}

interface IssuedToken {
  token: string;
  access_url: string;
  expires_at: string;
}

/** Статусы команды по Положению: подписи для решений Оргкомитета (ТЗ 07, п. 2.4). */
const TEAM_STATUS_ACTIONS: Array<{ value: string; title: string; dangerous?: boolean }> = [
  { value: 'allowed', title: 'Допустить (отборочный этап)' },
  { value: 'stage1', title: 'Перевести на первый этап' },
  { value: 'finalist', title: 'Признать финалистом' },
  { value: 'final', title: 'Допустить к финалу' },
  { value: 'winner', title: 'Признать победителем' },
  { value: 'disqualified', title: 'Дисквалифицировать', dangerous: true },
  { value: 'withdrawn', title: 'Зафиксировать отказ от участия' },
];

const TOKEN_DAYS = [
  { value: '30', title: '30 дней' },
  { value: '90', title: '90 дней' },
  { value: '180', title: '180 дней' },
  { value: '365', title: '365 дней' },
];

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

function tokenState(token: TeamToken): { title: string; active: boolean } {
  if (token.revoked_at !== null) return { title: 'Отозван', active: false };
  if (new Date(token.expires_at).getTime() < Date.now()) return { title: 'Срок истёк', active: false };
  return { title: 'Действует', active: true };
}

export function TeamsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const query = searchParams.get('q') ?? '';
  const seasonParam = searchParams.get('season_id');
  const parsedSeason = seasonParam === null ? null : Number(seasonParam);
  const [searchDraft, setSearchDraft] = useState(query);
  const [seasons, setSeasons] = useState<Season[]>([]);
  // Источник истины по сезону — адресная строка (п. 3.6): при отсутствии
  // параметра подставляется активный сезон из справочника.
  const [defaultSeasonId, setDefaultSeasonId] = useState<number | null>(null);
  const [seasonsReady, setSeasonsReady] = useState(false);
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [applicationByTeam, setApplicationByTeam] = useState<Map<number, number>>(new Map());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [tokens, setTokens] = useState<Record<number, TeamToken[]>>({});
  const [tokensLoading, setTokensLoading] = useState<number | null>(null);
  const [tokenLabel, setTokenLabel] = useState('');
  const [tokenDays, setTokenDays] = useState('90');
  const [issued, setIssued] = useState<Record<number, IssuedToken>>({});
  const [confirmRevoke, setConfirmRevoke] = useState<{ teamId: number; tokenId: number } | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ teamId: number; teamName: string; next: string } | null>(null);
  const [statusDraft, setStatusDraft] = useState<Record<number, string>>({});
  const [statusReason, setStatusReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Сезон из адресной строки; при отсутствии — активный сезон справочника. */
  const seasonId =
    parsedSeason !== null && Number.isFinite(parsedSeason) && parsedSeason > 0 ? parsedSeason : defaultSeasonId;

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  // Сезоны: по умолчанию активный. Параметр адресной строки имеет приоритет.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await adminApi.seasons();
        if (!active) return;
        setSeasons(list);
        setDefaultSeasonId(list.find((season) => season.is_active)?.id ?? list[0]?.id ?? null);
      } catch {
        // Без справочника сезонов список команд показывается целиком.
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
      const params: Record<string, string | number | undefined> = {};
      if (seasonId !== null) params.season_id = seasonId;
      if (status !== '') params.status = status;
      if (query !== '') params.q = query;
      // Список команд и заявок: заявки нужны только для ссылки на карточку.
      const [teams, applications] = await Promise.all([
        adminApi.resourceList<TeamRow>('teams', params),
        adminApi
          .applications(seasonId === null ? { limit: 1000 } : { season_id: seasonId, limit: 1000 })
          .catch((): AdminApplicationRow[] => []),
      ]);
      setRows(teams);
      setApplicationByTeam(new Map(applications.map((application) => [application.team_id, application.id])));
      setExpandedId(null);
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить список команд.'));
    } finally {
      setLoading(false);
    }
  }, [seasonId, status, query]);

  useEffect(() => {
    if (!seasonsReady) return;
    void load();
  }, [seasonsReady, load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  /** Решение Оргкомитета по команде: перевод на этап, дисквалификация, восстановление. */
  async function changeStatus(teamId: number, status: string, reason?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.updateTeam(teamId, {
        status,
        ...(status === 'disqualified' ? { disqualification_reason: reason ?? '' } : {}),
      });
      setNotice(
        status === 'disqualified'
          ? 'Команда дисквалифицирована, причина записана в карточку и в журнал действий.'
          : `Статус команды изменён: ${teamStatusTitle(status)}.`
      );
      setStatusTarget(null);
      setStatusReason('');
      await load();
    } catch (caught) {
      setError(explain(caught, 'Не удалось изменить статус команды.'));
    } finally {
      setBusy(false);
    }
  }

  async function loadTokens(teamId: number) {
    setTokensLoading(teamId);
    setError(null);
    try {
      const list = await adminApi.teamTokens(teamId);
      setTokens((current) => ({ ...current, [teamId]: list }));
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить список доступов команды.'));
    } finally {
      setTokensLoading(null);
    }
  }

  function toggleTeam(teamId: number) {
    const next = expandedId === teamId ? null : teamId;
    setExpandedId(next);
    // Уже выпущенная ссылка остаётся на экране, пока администратор сам не
    // подтвердит, что передал её команде: сервер второй раз её не покажет.
    if (next !== null && tokens[teamId] === undefined) void loadTokens(teamId);
  }

  async function issueToken(teamId: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.issueTeamToken(teamId, {
        label: tokenLabel.trim() === '' ? null : tokenLabel.trim(),
        days: Number(tokenDays),
      });
      setIssued((current) => ({ ...current, [teamId]: result }));
      setTokenLabel('');
      setNotice('Ссылка доступа выпущена. Передайте её команде: в панели она больше не появится.');
      await loadTokens(teamId);
    } catch (caught) {
      setError(explain(caught, 'Не удалось выпустить ссылку доступа.'));
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(teamId: number, tokenId: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.revokeTeamToken(tokenId);
      setConfirmRevoke(null);
      setNotice('Доступ отозван: по этой ссылке войти в личный кабинет команды больше нельзя.');
      await loadTokens(teamId);
    } catch (caught) {
      setError(explain(caught, 'Не удалось отозвать доступ.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Ссылка доступа скопирована в буфер обмена.');
      setError(null);
    } catch {
      setError('Скопировать автоматически не удалось. Выделите ссылку и скопируйте её вручную.');
    }
  }

  const selectedSeason = seasons.find((season) => season.id === seasonId) ?? null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Команды сезона"
        title="Команды"
        lead="Статус команды меняется решением по заявке: откройте карточку заявки. Здесь же выдаются и отзываются доступы в личный кабинет команды."
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
        description={
          selectedSeason
            ? `Сезон «${selectedSeason.title}». Команд в выборке: ${rows.length}.`
            : `Команд в выборке: ${rows.length}.`
        }
      >
        <form
          className="grid gap-4 md:grid-cols-[1fr,1fr,1fr,auto]"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setParam('q', searchDraft.trim());
          }}
        >
          {seasons.length > 0 ? (
            <SelectField
              id="teams-season"
              label="Сезон"
              value={seasonId === null ? '' : String(seasonId)}
              options={seasons.map((season) => ({
                value: String(season.id),
                title: `${season.title} (${season.year})${season.is_active ? ' — активный' : ''}`,
              }))}
              onChange={(event) => setParam('season_id', event.target.value)}
            />
          ) : null}
          <SelectField
            id="teams-status"
            label="Статус команды"
            value={status}
            options={Object.entries(TEAM_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
            placeholder="Все статусы"
            onChange={(event) => setParam('status', event.target.value)}
          />
          <TextField
            id="teams-search"
            label="Поиск по названию или организации"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Например, Правовой десант"
          />
          <div className="flex items-end">
            <Button type="submit" loading={loading}>
              Найти
            </Button>
          </div>
        </form>
        {status !== '' || query !== '' ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setSearchDraft('');
                const next = new URLSearchParams();
                if (seasonId !== null) next.set('season_id', String(seasonId));
                setSearchParams(next, { replace: true });
              }}
            >
              Сбросить фильтры
            </Button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Список команд"
        description="Ссылка «Карточка заявки» открывает рабочее место Оргкомитета: состав, согласия и решение технической проверки — оно и меняет статус команды."
      >
        {loading && rows.length === 0 ? <p role="status">Загружаем команды…</p> : null}

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-muted">
            {status === '' && query === ''
              ? 'Команд пока нет. Они появятся здесь после первой заявки.'
              : 'По этим условиям команд нет. Измените фильтры или сбросьте их.'}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <caption className="sr-only-text">Команды сезона</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4">
                      Команда
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Направление
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Статус
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Участники / наставники
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Капитан команды
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Материалы
                    </th>
                    <th scope="col" className="py-2">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((team) => {
                    const applicationId = applicationByTeam.get(team.id);
                    const isOpen = expandedId === team.id;
                    return (
                      <tr key={team.id} className="border-b border-border align-top">
                        <td className="py-3 pr-4">
                          {team.name}
                          {team.organization ? <span className="block text-muted">{team.organization}</span> : null}
                        </td>
                        <td className="py-3 pr-4">{team.direction_title ?? '—'}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge status={team.status} title={teamStatusTitle(team.status)} />
                        </td>
                        <td className="py-3 pr-4">
                          {team.participants_count} / {team.mentors_count}
                        </td>
                        <td className="py-3 pr-4">{team.captain_name ?? '—'}</td>
                        <td className="py-3 pr-4">{team.materials_count}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            {/* Решение Оргкомитета: перевод на этап, дисквалификация, восстановление. */}
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                aria-label={`Новое состояние команды ${team.name}`}
                                className="min-h-[44px] border border-border-strong bg-raised px-3 text-sm"
                                value={statusDraft[team.id] ?? ''}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  if (next === '') return;
                                  setStatusDraft((current) => ({ ...current, [team.id]: '' }));
                                  if (next === 'disqualified') {
                                    setStatusReason('');
                                    setStatusTarget({ teamId: team.id, teamName: team.name, next });
                                    return;
                                  }
                                  void changeStatus(team.id, next);
                                }}
                              >
                                <option value="">Решение по команде…</option>
                                {TEAM_STATUS_ACTIONS.filter((action) => action.value !== team.status).map((action) => (
                                  <option key={action.value} value={action.value}>
                                    {action.title}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {applicationId !== undefined ? (
                              <Link
                                to={`/applications/${applicationId}`}
                                className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
                              >
                                Карточка заявки
                              </Link>
                            ) : (
                              <Button
                                type="button"
                                variant="secondary"
                                disabled
                                title="Заявка ещё не создана: команда в черновике"
                              >
                                Карточка заявки
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="secondary"
                              aria-expanded={isOpen}
                              aria-controls={`team-access-${team.id}`}
                              onClick={() => toggleTeam(team.id)}
                            >
                              Доступ в личный кабинет
                            </Button>
                          </div>
                          {applicationId === undefined ? (
                            <p className="mt-2 text-sm text-muted">
                              Заявка ещё не создана: команда в черновике, карточки для решения нет.
                            </p>
                          ) : null}
                          {team.disqualification_reason ? (
                            <p className="mt-2 text-sm text-danger">
                              Причина дисквалификации: {team.disqualification_reason}
                            </p>
                          ) : null}
                          {statusTarget && statusTarget.teamId === team.id ? (
                            <div className="mt-4 border border-danger p-4">
                              <p className="font-medium">Дисквалификация команды «{team.name}»</p>
                              <p className="mt-1 text-sm text-muted">
                                Решение необратимо из панели без отдельного восстановления: команда не публикуется в
                                архиве и не допускается к этапам. Причина попадёт в карточку команды и в журнал действий.
                              </p>
                              <div className="mt-3 flex flex-col gap-3">
                                <TextAreaField
                                  id={`disqualify-${team.id}`}
                                  label="Причина дисквалификации"
                                  value={statusReason}
                                  onChange={(event) => setStatusReason(event.target.value)}
                                  hint="Например: нарушение раздела 13 Положения — недостоверные сведения о работе."
                                />
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="border-danger text-danger"
                                    loading={busy}
                                    disabled={statusReason.trim().length < 5}
                                    title={
                                      statusReason.trim().length < 5
                                        ? 'Причина обязательна: без неё решение не принимается'
                                        : undefined
                                    }
                                    onClick={() => void changeStatus(team.id, 'disqualified', statusReason.trim())}
                                  >
                                    Дисквалифицировать
                                  </Button>
                                  <Button type="button" variant="quiet" onClick={() => setStatusTarget(null)}>
                                    Отменить
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                          {isOpen ? (
                            <div id={`team-access-${team.id}`} className="mt-4 flex flex-col gap-4 border border-border p-4">
                              {tokensLoading === team.id ? <p role="status">Загружаем доступы…</p> : null}
                              {issued[team.id] ? (
                                <Alert tone="warning" title="Ссылка доступа показывается один раз">
                                  <p>
                                    Передайте её команде сейчас: в панели ссылка больше не появится, в базе хранится
                                    только её хеш. Действует до {formatMoscowHuman(issued[team.id]?.expires_at)}.
                                  </p>
                                  <dl className="mt-3 flex flex-col gap-2">
                                    <div>
                                      <dt className="mono-label text-muted">Код доступа</dt>
                                      <dd className="break-all font-mono">{issued[team.id]?.token}</dd>
                                    </div>
                                    <div>
                                      <dt className="mono-label text-muted">Ссылка доступа</dt>
                                      <dd className="break-all font-mono">{issued[team.id]?.access_url}</dd>
                                    </div>
                                  </dl>
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      onClick={() => void copyText(String(issued[team.id]?.access_url ?? ''))}
                                    >
                                      Скопировать ссылку
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="quiet"
                                      onClick={() =>
                                        setIssued((current) => {
                                          const copy = { ...current };
                                          delete copy[team.id];
                                          return copy;
                                        })
                                      }
                                    >
                                      Я передал ссылку команде
                                    </Button>
                                  </div>
                                </Alert>
                              ) : null}
                              <div className="grid gap-4 md:grid-cols-[1fr,1fr,auto]">
                                <TextField
                                  id={`token-label-${team.id}`}
                                  label="Пометка о получателе"
                                  value={tokenLabel}
                                  maxLength={200}
                                  onChange={(event) => setTokenLabel(event.target.value)}
                                  hint="Необязательно: например, «капитан команды»."
                                />
                                <SelectField
                                  id={`token-days-${team.id}`}
                                  label="Срок действия"
                                  value={tokenDays}
                                  options={TOKEN_DAYS}
                                  onChange={(event) => setTokenDays(event.target.value)}
                                />
                                <div className="flex items-end">
                                  <Button type="button" loading={busy} onClick={() => void issueToken(team.id)}>
                                    Выдать ссылку доступа
                                  </Button>
                                </div>
                              </div>
                              {(tokens[team.id] ?? []).length === 0 && tokensLoading !== team.id ? (
                                <p className="text-sm text-muted">
                                  Доступы не выпускались. Команда не сможет войти в личный кабинет, пока вы не выдадите
                                  ссылку.
                                </p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full min-w-[720px] border-collapse text-sm">
                                    <caption className="sr-only-text">Выпущенные доступы команды</caption>
                                    <thead>
                                      <tr className="border-b border-border-strong text-left">
                                        <th scope="col" className="py-2 pr-4">
                                          Пометка
                                        </th>
                                        <th scope="col" className="py-2 pr-4">
                                          Выдан
                                        </th>
                                        <th scope="col" className="py-2 pr-4">
                                          Действует до
                                        </th>
                                        <th scope="col" className="py-2 pr-4">
                                          Использований
                                        </th>
                                        <th scope="col" className="py-2 pr-4">
                                          Состояние
                                        </th>
                                        <th scope="col" className="py-2">
                                          Действия
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(tokens[team.id] ?? []).map((token) => {
                                        const state = tokenState(token);
                                        return (
                                          <tr key={token.id} className="border-b border-border align-top">
                                            <td className="py-2 pr-4">{token.label ?? '—'}</td>
                                            <td className="py-2 pr-4">{formatMoscowHuman(token.created_at)}</td>
                                            <td className="py-2 pr-4">{formatMoscowHuman(token.expires_at)}</td>
                                            <td className="py-2 pr-4">
                                              {token.max_uses === 0
                                                ? `${token.used_count} — без ограничения`
                                                : `${token.used_count} из ${token.max_uses}`}
                                            </td>
                                            <td className="py-2 pr-4">
                                              <span className={state.active ? 'text-success' : 'text-muted'}>
                                                {state.title}
                                              </span>
                                            </td>
                                            <td className="py-2">
                                              <Button
                                                type="button"
                                                variant="secondary"
                                                className="border-danger text-danger"
                                                disabled={!state.active}
                                                title={
                                                  state.active
                                                    ? undefined
                                                    : 'Отозвать можно только действующий доступ'
                                                }
                                                onClick={() =>
                                                  setConfirmRevoke({ teamId: team.id, tokenId: token.id })
                                                }
                                              >
                                                Отозвать
                                              </Button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {confirmRevoke !== null && confirmRevoke.teamId === team.id ? (
                                <Alert tone="danger" title="Отозвать доступ?">
                                  <p>
                                    Ссылка перестанет работать сразу: команда потеряет вход в личный кабинет и не сможет
                                    загрузить материалы до выпуска новой ссылки. Прежние действия команды сохранятся.
                                  </p>
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      loading={busy}
                                      onClick={() => void revokeToken(confirmRevoke.teamId, confirmRevoke.tokenId)}
                                    >
                                      Отозвать доступ
                                    </Button>
                                    <Button type="button" variant="quiet" onClick={() => setConfirmRevoke(null)}>
                                      Оставить
                                    </Button>
                                  </div>
                                </Alert>
                              ) : null}
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
              {rows.map((team) => {
                const applicationId = applicationByTeam.get(team.id);
                const isOpen = expandedId === team.id;
                return (
                  <li key={`card-${team.id}`} className="border border-border p-4 text-sm">
                    <p className="font-semibold">{team.name}</p>
                    <p className="mt-1 text-muted">{team.direction_title ?? 'направление не выбрано'}</p>
                    <div className="mt-2">
                      <StatusBadge status={team.status} title={teamStatusTitle(team.status)} />
                    </div>
                    <dl className="mt-3 flex flex-col gap-2">
                      <div>
                        <dt className="text-muted">Участники / наставники</dt>
                        <dd>
                          {team.participants_count} / {team.mentors_count}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Капитан команды</dt>
                        <dd>{team.captain_name ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Конкурсных материалов</dt>
                        <dd>{team.materials_count}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {applicationId !== undefined ? (
                        <Link
                          to={`/applications/${applicationId}`}
                          className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
                        >
                          Карточка заявки
                        </Link>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled
                          title="Заявка ещё не создана: команда в черновике"
                        >
                          Карточка заявки
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        aria-expanded={isOpen}
                        aria-controls={`team-card-access-${team.id}`}
                        onClick={() => toggleTeam(team.id)}
                      >
                        Доступ в личный кабинет
                      </Button>
                    </div>
                    {isOpen ? (
                      <div id={`team-card-access-${team.id}`} className="mt-4 flex flex-col gap-4 border border-border p-4">
                        {tokensLoading === team.id ? <p role="status">Загружаем доступы…</p> : null}
                        {issued[team.id] ? (
                          <Alert tone="warning" title="Ссылка доступа показывается один раз">
                            <p>
                              Передайте её команде сейчас: в панели ссылка больше не появится. Действует до{' '}
                              {formatMoscowHuman(issued[team.id]?.expires_at)}.
                            </p>
                            <p className="mt-2 break-all font-mono">{issued[team.id]?.access_url}</p>
                            <div className="mt-3 flex flex-wrap gap-3">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void copyText(String(issued[team.id]?.access_url ?? ''))}
                              >
                                Скопировать ссылку
                              </Button>
                            </div>
                          </Alert>
                        ) : null}
                        <TextField
                          id={`token-card-label-${team.id}`}
                          label="Пометка о получателе"
                          value={tokenLabel}
                          maxLength={200}
                          onChange={(event) => setTokenLabel(event.target.value)}
                          hint="Необязательно: например, «капитан команды»."
                        />
                        <SelectField
                          id={`token-card-days-${team.id}`}
                          label="Срок действия"
                          value={tokenDays}
                          options={TOKEN_DAYS}
                          onChange={(event) => setTokenDays(event.target.value)}
                        />
                        <Button type="button" loading={busy} onClick={() => void issueToken(team.id)}>
                          Выдать ссылку доступа
                        </Button>
                        {(tokens[team.id] ?? []).length === 0 && tokensLoading !== team.id ? (
                          <p className="text-muted">
                            Доступы не выпускались. Команда не сможет войти в личный кабинет, пока вы не выдадите ссылку.
                          </p>
                        ) : null}
                        {(tokens[team.id] ?? []).length > 0 ? (
                          <ul className="flex flex-col gap-3">
                            {(tokens[team.id] ?? []).map((token) => {
                              const state = tokenState(token);
                              return (
                                <li key={`token-card-${token.id}`} className="border border-border p-3">
                                  <p className="mono-label text-muted">
                                    {token.label ?? 'без пометки'} · {state.title}
                                  </p>
                                  <p className="mt-1">Выдан {formatMoscowHuman(token.created_at)}</p>
                                  <p className="mt-1 text-muted">
                                    Действует до {formatMoscowHuman(token.expires_at)} · использований:{' '}
                                    {token.max_uses === 0
                                      ? `${token.used_count} (без ограничения)`
                                      : `${token.used_count} из ${token.max_uses}`}
                                  </p>
                                  <div className="mt-2">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="border-danger text-danger"
                                      disabled={!state.active}
                                      title={
                                        state.active ? undefined : 'Отозвать можно только действующий доступ'
                                      }
                                      onClick={() => setConfirmRevoke({ teamId: team.id, tokenId: token.id })}
                                    >
                                      Отозвать
                                    </Button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                        {confirmRevoke !== null && confirmRevoke.teamId === team.id ? (
                          <Alert tone="danger" title="Отозвать доступ?">
                            <p>
                              Ссылка перестанет работать сразу: команда потеряет вход в личный кабинет и не сможет
                              загрузить материалы до выпуска новой ссылки.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-3">
                              <Button
                                type="button"
                                variant="secondary"
                                loading={busy}
                                onClick={() => void revokeToken(confirmRevoke.teamId, confirmRevoke.tokenId)}
                              >
                                Отозвать доступ
                              </Button>
                              <Button type="button" variant="quiet" onClick={() => setConfirmRevoke(null)}>
                                Оставить
                              </Button>
                            </div>
                          </Alert>
                        ) : null}
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
