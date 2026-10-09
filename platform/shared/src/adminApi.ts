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
  AdminTeamCard,
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
/** Участник команды в админке (ответ /api/admin/participants). */
export interface AdminParticipantRow {
  id: number;
  team_id: number;
  full_name: string;
  role: string;
  category?: string | null;
  birth_date?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  position?: string | null;
  education?: string | null;
  is_minor?: boolean | null;
  consent_pdn?: boolean | null;
  team_name?: string | null;
}

/** Файл в хранилище (ответ /api/admin/media). */
export interface AdminMediaFile {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  is_public: boolean;
  category: string;
  created_at?: string;
}

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
  /** Страница и размер страницы (ТЗ 07, п. 1.4). */
  page?: number;
  perPage?: number;
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

  /** Список заявок вместе с метаданными: всего записей, страница, размер. */
  applicationsPage: (params: ApplicationQuery = {}) =>
    adminRequestWithMeta<AdminApplicationRow[]>(`/api/admin/applications${queryString(params)}`),

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

  /** Материалы вместе с метаданными: всего записей, страница, размер страницы. */
  materialsPage: (params: { status?: string; team_id?: number; deadline?: string; page?: number; perPage?: number } = {}) =>
    adminRequestWithMeta<AdminMaterial[]>(`/api/admin/materials${queryString(params)}`),

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
  /** Выдача разовой ссылки эксперту (ТЗ 07, п. 2.5). */
  issueExpertAccess: (expertId: number, payload: { expires_in_days?: number; label?: string | null } = {}) =>
    adminRequest<{
      id: number;
      token: string;
      expires_at: string;
      revoked_previous: number;
      access_path: string;
      access_url: string;
    }>(`/api/admin/experts/${expertId}/access`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  expertAccess: (expertId: number) =>
    adminRequest<{
      tokens: Array<{
        id: number;
        label: string | null;
        expires_at: string;
        revoked_at: string | null;
        last_used_at: string | null;
        used_count: number;
        created_at: string;
      }>;
      log: Array<{ event: string; team_id: number | null; ip: string | null; created_at: string }>;
    }>(`/api/admin/experts/${expertId}/access`),

  revokeExpertAccess: (expertId: number) =>
    adminRequest<{ success: boolean; revoked: number }>(`/api/admin/experts/${expertId}/access/revoke`, {
      method: 'POST',
    }),

  /** Карточка команды: состав, участие в этапах, результаты, история (ТЗ 07, п. 2.4). */
  teamCard: (teamId: number) => adminRequest<AdminTeamCard>(`/api/admin/teams/${teamId}`),

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
    /** Конфликт интересов: оценка сохраняется, но не учитывается (ТЗ 07, п. 2.7). */
    is_conflicted?: boolean;
    conflict_reason?: string | null;
  }) =>
    adminRequest<Evaluation>('/api/admin/evaluations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rankings: (params: { season_id?: number; stage?: string } = {}) =>
    adminRequest<Ranking[]>(`/api/admin/rankings${queryString(params)}`),

  /** Журнал действий: кто, что и когда изменил. */
  audits: (
    params: {
      entity?: string;
      action?: string;
      q?: string;
      user_id?: number;
      from?: string;
      to?: string;
      limit?: number;
      page?: number;
      perPage?: number;
    } = {}
  ) => adminRequest<AuditRecord[]>(`/api/admin/audit${queryString(params)}`),

  /** Журнал вместе с метаданными: для постраничности (ТЗ 07, п. 2.17). */
  auditsPage: (
    params: {
      entity?: string;
      action?: string;
      q?: string;
      user_id?: number;
      from?: string;
      to?: string;
      page?: number;
      perPage?: number;
    } = {}
  ) => adminRequestWithMeta<AuditRecord[]>(`/api/admin/audit${queryString(params)}`),

  /** Выгрузка журнала в CSV (ТЗ 07, п. 2.17): файл тянется с токеном сессии. */
  exportAudit: async (
    params: { entity?: string; action?: string; q?: string; user_id?: number; from?: string; to?: string } = {}
  ): Promise<Blob> => {
    const token = getAdminToken();
    const response = await fetch(`/api/admin/audit/export${queryString(params)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new AdminApiError(response.status, 'Не удалось выгрузить журнал.');
    return response.blob();
  },

  /** Предпросмотр массового импорта архива (ТЗ 07, п. 2.14а). */
  previewInitiativesImport: async (file: File): Promise<{
    format: string;
    file_name: string;
    headers: string[];
    total: number;
    ready: number;
    blocked: number;
    rows: Array<{ row: number; values: Record<string, unknown>; errors: string[]; is_duplicate: boolean }>;
  }> => {
    const token = getAdminToken();
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/admin/initiatives/import/preview', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
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
    if (!response.ok) throwAdminError(response.status, payload);
    return unwrapEnvelope(payload);
  },

  /** Запись подготовленных строк импорта. */
  applyInitiativesImport: (rows: Array<{ row: number; values: Record<string, unknown> }>) =>
    adminRequest<{ success: boolean; created: number; updated: number; skipped: number[]; note: string }>(
      '/api/admin/initiatives/import',
      { method: 'POST', body: JSON.stringify({ rows }) }
    ),

  /** Авторы инициативы (ТЗ 07, п. 2.14а): публикуются выборочно, по согласию. */
  initiativeAuthors: (initiativeId: number) =>
    adminRequest<
      Array<{
        id: number;
        full_name: string;
        organization: string | null;
        region: string | null;
        is_published: boolean;
        sort_order: number;
      }>
    >(`/api/admin/initiatives/${initiativeId}/authors`),

  addInitiativeAuthor: (
    initiativeId: number,
    payload: { full_name: string; organization?: string | null; region?: string | null; is_published?: boolean; sort_order?: number }
  ) =>
    adminRequest<{ id: number; full_name: string }>(`/api/admin/initiatives/${initiativeId}/authors`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateInitiativeAuthor: (
    initiativeId: number,
    authorId: number,
    payload: { full_name?: string; organization?: string | null; region?: string | null; is_published?: boolean; sort_order?: number }
  ) =>
    adminRequest<{ id: number }>(`/api/admin/initiatives/${initiativeId}/authors/${authorId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteInitiativeAuthor: (initiativeId: number, authorId: number) =>
    adminRequest<{ success: boolean }>(`/api/admin/initiatives/${initiativeId}/authors/${authorId}`, {
      method: 'DELETE',
    }),

  /** Матрица «команда × эксперт» с прогрессом заполнения (ТЗ 07, п. 2.7). */
  evaluationMatrix: (seasonId: number, stage: string) =>
    adminRequest<{
      stage: string;
      min_evaluations: number;
      experts: Array<{ id: number; full_name: string; role: string | null }>;
      rows: Array<{
        team_id: number;
        team_name: string;
        direction_title: string | null;
        cells: Array<{ expert_id: number; filled: boolean; total_score: string | number | null; is_conflicted: boolean }>;
        evaluations_count: number;
        is_ready: boolean;
      }>;
    }>(`/api/admin/evaluations/matrix${queryString({ season_id: seasonId, stage })}`),

  /** Загрузка PDF протокола этапа (ТЗ 07, п. 2.8). */
  uploadRankingsProtocol: async (seasonId: number, stage: string, file: File): Promise<{ file_url: string; rows: number }> => {
    const token = getAdminToken();
    const form = new FormData();
    form.append('season_id', String(seasonId));
    form.append('stage', stage);
    form.append('file', file);
    const response = await fetch('/api/admin/rankings/protocol', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
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
    if (!response.ok) throwAdminError(response.status, payload);
    return unwrapEnvelope<{ file_url: string; rows: number }>(payload);
  },

  removeRankingsProtocol: (seasonId: number, stage: string) =>
    adminRequest<{ success: boolean; updated: number }>(
      `/api/admin/rankings/protocol${queryString({ season_id: seasonId, stage })}`,
      { method: 'DELETE' }
    ),

  recalculateRankings: (seasonId: number, stage: string) =>
    adminRequest<{ stage: string; teams: unknown[]; message?: string }>('/api/admin/rankings/recalculate', {
      method: 'POST',
      body: JSON.stringify({ season_id: seasonId, stage }),
    }),

  /**
   * Публикация и снятие протокола (ТЗ 07, п. 2.8).
   * Снятие требует причины: она попадает в журнал действий.
   */
  publishRankings: (seasonId: number, stage: string, isPublished = true, reason?: string) =>
    adminRequest<{
      published: number;
      published_at?: string;
      message?: string;
      ties?: Array<{ team: string; average_score: string | number; place: number }>;
      without_evaluations?: string[];
      /** Замечания по оцениванию: публикация не блокируется, но их нужно видеть. */
      warnings?: string[];
    }>('/api/admin/rankings/publish', {
      method: 'POST',
      body: JSON.stringify({ season_id: seasonId, stage, is_published: isPublished, reason }),
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

  // ── Участники (ТЗ 07, п. 2.4) ────────────────────────────────────────────
  // Правка данных участника из карточки команды: раньше состав был доступен
  // только для чтения, хотя сервер принимает изменения.
  participants: (params: { team_id?: number; q?: string } = {}) =>
    adminRequest<AdminParticipantRow[]>(`/api/admin/participants${queryString(params)}`),

  updateParticipant: (
    id: number,
    payload: {
      full_name?: string | null;
      organization?: string | null;
      position?: string | null;
      education?: string | null;
      email?: string | null;
      phone?: string | null;
      role?: string;
      category?: string;
      birth_date?: string | null;
    }
  ) =>
    adminRequest<AdminParticipantRow>(`/api/admin/participants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // ── Файлы (ТЗ 07, п. 2.11–2.14) ──────────────────────────────────────────
  // Раньше загрузки не было вовсе: поля вроде логотипа партнёра или PDF
  // Положения требовали UUID файла, а взять его было негде.
  mediaList: (category?: string) =>
    adminRequest<AdminMediaFile[]>(`/api/admin/media${category ? `?category=${encodeURIComponent(category)}` : ''}`),

  mediaUpload: (file: File, options: { category?: string; isPublic?: boolean } = {}) => {
    const form = new FormData();
    form.set('file', file);
    form.set('category', options.category ?? 'document');
    form.set('is_public', options.isPublic === true ? 'true' : 'false');
    return adminRequest<AdminMediaFile>('/api/admin/media', { method: 'POST', body: form }, 120_000);
  },

  mediaDelete: (id: string) => adminRequest<{ success: true }>(`/api/admin/media/${id}`, { method: 'DELETE' }),

  /** Краткосрочная ссылка на приватный файл: чтобы передать коллеге (ТЗ 11, п. 24). */
  mediaLink: (id: string) =>
    adminRequest<{ path: string; expires_in: number }>(`/api/admin/media/${id}/link`, { method: 'POST' }),

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

  /**
   * Ответ на обращение (ТЗ 07, п. 2.15). Письмо не отправляется: почтовый
   * транспорт не выбран, поэтому ответ фиксируется в карточке обращения.
   */
  respondLead: (id: number, responseText: string) =>
    adminRequest<AdminLead & { delivery?: string; delivery_note?: string }>(`/api/admin/leads/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ response_text: responseText }),
    }),

  appeals: (params: { status?: string; stage?: string } = {}) => adminRequest<AdminAppeal[]>(`/api/admin/appeals${queryString(params)}`),

  /** Апелляции вместе с метаданными: всего записей, страница, размер страницы. */
  appealsPage: (params: { status?: string; stage?: string; season_id?: number; page?: number; perPage?: number } = {}) =>
    adminRequestWithMeta<AdminAppeal[]>(`/api/admin/appeals${queryString(params)}`),

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
