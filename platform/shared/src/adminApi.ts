import type {
  AdminApplicationCard,
  AdminApplicationRow,
  AdminConsent,
  AdminDistributionConsent,
  AdminMaterial,
  AdminSessionInfo,
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

async function adminRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
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

    if (!response.ok) {
      const body = payload as { error?: unknown };
      const message = typeof body.error === 'string' ? body.error : 'Запрос не выполнен.';
      throw new AdminApiError(response.status, message);
    }

    return payload as T;
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

  reviewMaterial: (
    id: number,
    payload: { status: string; reviewer_comment?: string | null; fix_deadline?: string | null }
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
};
