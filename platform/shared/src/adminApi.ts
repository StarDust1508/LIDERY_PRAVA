import type {
  AdminAppeal,
  AdminApplicationCard,
  AdminApplicationRow,
  AdminConsent,
  AdminDistributionConsent,
  AdminMaterial,
  AdminLead,
  AdminPdnRequest,
  AdminPdnSubjectSearch,
  AdminLegacyApplication,
  AdminSessionInfo,
  AdminStats,
  AdminUser,
  AdminUserRole,
  AuditRecord,
  Criterion,
  Evaluation,
  EvaluationScore,
  Expert,
  Ranking,
} from './types';

// Клиент админ-API. Токен админ-сессии (HMAC) хранится в localStorage и
// передаётся заголовком Authorization: Bearer. Cookie сессии кабинета здесь
// не используется: у админки отдельный контур (ТЗ 03, «Почему две сборки»).

const TOKEN_KEY = 'lp_admin_token';

export function getAdminToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Приватный режим браузера: сессия проживёт до перезагрузки страницы.
  }
}

export class AdminApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

/**
 * Разворачивает обёртку ответа `{ data, meta }` (ТЗ 05, п. 1.1).
 * Снимается в одном месте, поэтому экраны админки работают с данными напрямую.
 */
export function unwrapEnvelope<T>(payload: unknown): T {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > 0 && keys.every((key) => key === 'data' || key === 'meta')) {
      return record.data as T;
    }
  }
  return payload as T;
}

/** Ответ списка с метаданными: сколько всего записей, страница и размер страницы. */
export interface AdminListMeta {
  total: number;
  page: number;
  perPage: number;
}

/**
 * Списочный запрос с метаданными: нужен постраничности в админке
 * (ТЗ 07, п. 1.4 — по 50 записей на страницу).
 */
export async function adminRequestWithMeta<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<{ data: T; meta: AdminListMeta | null }> {
  const { ok, status, payload } = await adminSend(path, init, timeoutMs);
  if (!ok) throwAdminError(status, payload);
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const meta = (typeof record.meta === 'object' && record.meta !== null ? record.meta : null) as AdminListMeta | null;
  return { data: unwrapEnvelope<T>(payload), meta };
}

/** Превращает тело ошибки в AdminApiError (ТЗ 05, п. 1.2). */
function throwAdminError(status: number, payload: unknown): never {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as { error?: unknown };
  const nested = (typeof body.error === 'object' && body.error !== null ? body.error : {}) as {
    message?: unknown;
  };
  const message =
    typeof body.error === 'string'
      ? body.error
      : typeof nested.message === 'string'
        ? nested.message
        : 'Запрос не выполнен.';
  throw new AdminApiError(status, message);
}

/** Единственное место, где админка выполняет запрос. */
async function adminSend(
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const token = getAdminToken();
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: unknown = {};
    if (raw !== '') {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = {};
      }
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AdminApiError(0, 'Сервер отвечает слишком долго.');
    }
    throw new AdminApiError(0, 'Сервер недоступен.');
  } finally {
    clearTimeout(timer);
  }
}

async function adminRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const { ok, status, payload } = await adminSend(path, init, timeoutMs);
  if (!ok) throwAdminError(status, payload);
  return unwrapEnvelope<T>(payload);
}

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export interface ApplicationQuery {
  q?: string;
  tech_status?: string;
  direction_id?: number;
  season_id?: number;
  limit?: number;
  offset?: number;
}

export const adminApi = {
  login: (login: string, password: string) =>
    adminRequest<{ token: string; token_type: string } & AdminSessionInfo>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),

  verify: () => adminRequest<AdminSessionInfo>('/api/admin/verify'),

  logout: () => adminRequest<{ success: true }>('/api/admin/logout', { method: 'POST' }),

  /** Отметка активности: продлевает сеанс, не читая данные. */
  heartbeat: () =>
    adminRequest<{ success: true; idle_minutes: number }>('/api/admin/sessions/heartbeat', { method: 'POST' }),

  // Пользователи админ-панели — раздел только для роли `admin` (ТЗ 07, п. 2.17).
  users: (params: { q?: string; role?: string } = {}) =>
    adminRequest<AdminUser[]>(`/api/admin/users${queryString(params)}`),

  createUser: (payload: { email: string; password: string; role: AdminUserRole; full_name?: string | null }) =>
    adminRequest<AdminUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }),

  updateUser: (id: number, patch: { role?: AdminUserRole; is_active?: boolean; full_name?: string | null; blocked_reason?: string | null }) =>
    adminRequest<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  resetUserPassword: (id: number, password: string) =>
    adminRequest<{ success: true; sessions_revoked: boolean; must_change_password: boolean }>(
      `/api/admin/users/${id}/password`,
      { method: 'POST', body: JSON.stringify({ password }) }
    ),

  revokeUserSessions: (id: number) =>
    adminRequest<{ success: true; sessions_revoked: boolean; self: boolean }>(
      `/api/admin/users/${id}/revoke-sessions`,
      { method: 'POST' }
    ),

  applications: (params: ApplicationQuery = {}) =>
    adminRequest<AdminApplicationRow[]>(`/api/admin/applications${queryString(params)}`),

  application: (id: number) => adminRequest<AdminApplicationCard>(`/api/admin/applications/${id}`),

  applicationConsents: (id: number) =>
    adminRequest<{ consents: AdminConsent[]; distribution: AdminDistributionConsent[] }>(
      `/api/admin/applications/${id}/consents`
    ),

  updateApplication: (
    id: number,
    patch: { tech_status?: string; tech_rejection_reason?: string | null; organizer_notes?: string | null }
  ) =>
    adminRequest<AdminApplicationRow>(`/api/admin/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Выгрузка CSV: файл тянется blob-ом, потому что нужен заголовок с токеном. */
  exportApplications: async (params: ApplicationQuery = {}): Promise<Blob> => {
    const token = getAdminToken();
    const response = await fetch(`/api/admin/applications/export${queryString(params)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new AdminApiError(response.status, 'Не удалось выгрузить CSV.');
    return response.blob();
  },

  materials: (params: { status?: string; team_id?: number } = {}) =>
    adminRequest<AdminMaterial[]>(`/api/admin/materials${queryString(params)}`),

  // Сервер читает поле `comment` (routes/admin.ts, POST /materials/:id/review).
  reviewMaterial: (
    id: number,
    payload: { status: string; comment?: string | null; fix_deadline?: string | null }
  ) =>
    adminRequest<AdminMaterial>(`/api/admin/materials/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * Файл материала. Приватные файлы отдаются только по админ-сессии, а обычная
   * ссылка не может передать заголовок Authorization, поэтому файл тянется
   * blob-ом и открывается уже на стороне браузера.
   */
  materialFile: async (mediaId: string): Promise<Blob> => {
    const token = getAdminToken();
    const response = await fetch(`/api/media/file/${encodeURIComponent(mediaId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new AdminApiError(response.status, 'Файл недоступен.');
    return response.blob();
  },

  criteria: (stage: string) => adminRequest<Criterion[]>(`/api/admin/criteria${queryString({ stage })}`),

  /** Сезоны конкурса: нужны для расчёта и публикации рейтинга. */
  seasons: () =>
    adminRequest<Array<{ id: number; slug: string; title: string; year: number; is_active: boolean }>>(
      '/api/admin/seasons'
    ),

  /** Команды сезона: в рейтинге показываем название, а не идентификатор. */
  teams: (seasonId?: number) =>
    adminRequest<
      Array<{ id: number; name: string; season_id: number; status: string; direction_title: string | null }>
    >(`/api/admin/teams${queryString({ season_id: seasonId })}`),

  experts: () => adminRequest<Expert[]>('/api/admin/experts'),

  evaluations: (params: { stage?: string; team_id?: number } = {}) =>
    adminRequest<Evaluation[]>(`/api/admin/evaluations${queryString(params)}`),

  saveEvaluation: (payload: {
    team_id: number;
    stage: string;
    expert_id?: number | null;
    jury_member_id?: number | null;
    scores: EvaluationScore[];
    comment?: string | null;
    recommendations?: string | null;
    is_chair_extra?: boolean;
    is_final_vote?: boolean;
  }) =>
    adminRequest<Evaluation>('/api/admin/evaluations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rankings: (params: { season_id?: number; stage?: string } = {}) =>
    adminRequest<Ranking[]>(`/api/admin/rankings${queryString(params)}`),

  /** Журнал действий: кто, что и когда изменил. */
  audits: (params: { entity?: string; action?: string; q?: string; limit?: number } = {}) =>
    adminRequest<AuditRecord[]>(`/api/admin/audit${queryString(params)}`),

  recalculateRankings: (seasonId: number, stage: string) =>
    adminRequest<{ stage: string; teams: unknown[]; message?: string }>('/api/admin/rankings/recalculate', {
      method: 'POST',
      body: JSON.stringify({ season_id: seasonId, stage }),
    }),

  publishRankings: (seasonId: number, stage: string) =>
    adminRequest<{ published: number; published_at?: string; message?: string }>('/api/admin/rankings/publish', {
      method: 'POST',
      body: JSON.stringify({ season_id: seasonId, stage }),
    }),

  /** Архив заявок сезона 2026 из прежней системы: только чтение (ТЗ 10, п. 3.1). */
  legacyApplications: (params: { q?: string; status?: string } = {}) =>
    adminRequest<AdminLegacyApplication[]>(`/api/admin/legacy-applications${queryString(params)}`),

  // ── Права субъекта персональных данных (ТЗ 11, п. 6) ──────────────────────
  pdnSubjects: (query: string) =>
    adminRequest<AdminPdnSubjectSearch>(`/api/admin/subjects${queryString({ query })}`),

  pdnSubject: (kind: string, id: number) =>
    adminRequest<{ kind: string; person: Record<string, unknown>; consents: Array<Record<string, unknown>> }>(
      `/api/admin/subjects/${kind}/${id}`
    ),

  pdnSubjectExport: (kind: string, id: number) =>
    adminRequest<{ exported_at: string; person: Record<string, unknown>; consents: Array<Record<string, unknown>> }>(
      `/api/admin/subjects/${kind}/${id}/export`
    ),

  pdnSubjectErase: (kind: string, id: number, reason: string) =>
    adminRequest<{ success: true; message: string }>(`/api/admin/subjects/${kind}/${id}/erase`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true, reason }),
    }),

  pdnRequests: (params: { status?: string } = {}) =>
    adminRequest<AdminPdnRequest[]>(`/api/admin/subjects/requests${queryString(params)}`),

  createPdnRequest: (payload: {
    kind: string;
    subject_name: string;
    subject_email: string;
    channel?: string;
    message?: string | null;
    received_at?: string | null;
  }) =>
    adminRequest<AdminPdnRequest>('/api/admin/subjects/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePdnRequest: (id: number, payload: { status?: string; resolution?: string | null }) =>
    adminRequest<AdminPdnRequest>(`/api/admin/subjects/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // ── Сводка и счётчики внимания (ТЗ 07, п. 1.7 и 2.1) ───────────────────────
  stats: (params: { season_id?: number } = {}) => adminRequest<AdminStats>(`/api/admin/stats${queryString(params)}`),

  // ── Массовые операции с предпросмотром (ТЗ 07, п. 3.3) ─────────────────────
  bulkApplications: (payload: {
    ids: number[];
    patch: { tech_status?: string; tech_rejection_reason?: string | null; organizer_notes?: string | null };
    dry_run?: boolean;
  }) =>
    adminRequest<{ dry_run: boolean; affected: number; preview: Array<Record<string, unknown>> }>(
      '/api/admin/applications/bulk',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  bulkMaterials: (payload: {
    ids: number[];
    action: 'accept' | 'request_fix' | 'block';
    comment?: string | null;
    dry_run?: boolean;
  }) =>
    adminRequest<{ dry_run: boolean; affected: number; preview: Array<Record<string, unknown>> }>(
      '/api/admin/materials/bulk',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // ── Универсальный CRUD справочников и контента (ТЗ 07, п. 2.3–2.14) ────────
  // Один набор методов на все разделы: сервер уже отдаёт их через buildCrud,
  // поэтому интерфейс описывает раздел конфигурацией, а не отдельным экраном.
  resourceList: <T>(resource: string, params: Record<string, string | number | boolean | undefined> = {}) =>
    adminRequest<T[]>(`/api/admin/${resource}${queryString(params)}`),

  /**
   * Список вместе с метаданными: сколько всего записей и какая страница
   * (ТЗ 07, п. 1.4 — по 50 записей на страницу).
   */
  resourceListPage: <T>(
    resource: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ) => adminRequestWithMeta<T[]>(`/api/admin/${resource}${queryString(params)}`),

  resourceCreate: <T>(resource: string, payload: Record<string, unknown>) =>
    adminRequest<T>(`/api/admin/${resource}`, { method: 'POST', body: JSON.stringify(payload) }),

  resourceUpdate: <T>(resource: string, id: number, payload: Record<string, unknown>) =>
    adminRequest<T>(`/api/admin/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  resourceGet: <T>(resource: string, id: number) => adminRequest<T>(`/api/admin/${resource}/${id}`),

  resourceDelete: (resource: string, id: number) =>
    adminRequest<{ success: true }>(`/api/admin/${resource}/${id}`, { method: 'DELETE' }),

  // ── Обращения, апелляции, настройки ───────────────────────────────────────
  leads: (params: { status?: string; q?: string } = {}) => adminRequest<AdminLead[]>(`/api/admin/leads${queryString(params)}`),

  updateLead: (id: number, payload: { status?: string; admin_comment?: string | null }) =>
    adminRequest<AdminLead>(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  appeals: (params: { status?: string; stage?: string } = {}) => adminRequest<AdminAppeal[]>(`/api/admin/appeals${queryString(params)}`),

  // Поля решения по апелляции: статус, решение, обоснование и ссылка на протокол
  // (routes/admin.ts, PATCH /appeals/:id).
  decideAppeal: (
    id: number,
    payload: {
      status?: string;
      decision?: string | null;
      decision_note?: string | null;
      protocol_url?: string | null;
    }
  ) =>
    adminRequest<AdminAppeal>(`/api/admin/appeals/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  settings: () =>
    adminRequest<Array<{ key: string; value: unknown; description: string | null; updated_by: number | null; updated_at: string }>>(
      '/api/admin/settings'
    ),

  saveSetting: (key: string, value: unknown) =>
    adminRequest<{ key: string; value: unknown; revision: number }>(`/api/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  settingRevisions: (key: string) =>
    adminRequest<Array<{ id: number; key: string; value: unknown; actor: string | null; created_at: string }>>(
      `/api/admin/settings/${encodeURIComponent(key)}/revisions`
    ),

  // ── Команды и доступы (ТЗ 07, п. 2.5) ─────────────────────────────────────
  /** Смена статуса команды: допуск, этапы, дисквалификация (ТЗ 07, п. 2.5). */
  updateTeam: (
    teamId: number,
    payload: { status?: string; disqualification_reason?: string | null; organization?: string | null; city?: string | null }
  ) =>
    adminRequest<{ id: number; name: string; status: string }>(`/api/admin/teams/${teamId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  teamTokens: (teamId: number) =>
    adminRequest<Array<{ id: number; label: string | null; created_at: string; expires_at: string; revoked_at: string | null; used_count: number; max_uses: number }>>(
      `/api/admin/teams/${teamId}/tokens`
    ),

  issueTeamToken: (teamId: number, payload: { label?: string | null; days?: number } = {}) =>
    adminRequest<{ token: string; access_url: string; expires_at: string }>(`/api/admin/teams/${teamId}/tokens`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  revokeTeamToken: (tokenId: number) =>
    adminRequest<{ success: true }>(`/api/admin/tokens/${tokenId}/revoke`, { method: 'POST' }),
};
