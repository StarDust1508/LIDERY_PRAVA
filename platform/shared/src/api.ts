import type {
  Appeal,
  AppealSubmissionResponse,
  ApplicationCreated,
  ApplicationStatus,
  CabinetAccessResponse,
  CabinetSessionResponse,
  CreateApplicationPayload,
  DeadlinesResponse,
  Direction,
  FinalConfirmationResponse,
  InitiativeCard,
  InitiativeListItem,
  Material,
  MaterialRequirementsResponse,
  PublicDocument,
  PublicCriterion,
  PublicExpert,
  PublicMasterclass,
  PublicNews,
  PublicNewsItem,
  LeadPayload,
  LeadResult,
  PublicPage,
  PublicPartner,
  SeasonResponse,
  SubmissionResponse,
  SubmitApplicationPayload,
  TeamResponse,
  Winner,
  WithdrawResponse,
} from './types';

/** Строка запроса для публичных списков: пустые значения не отправляются. */
function publicQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

// Единый клиент API для публичной части и админки (ТЗ 03, «Что делается в каком
// порядке»: общий код живёт в platform/shared).
//
// Cookie сессии кабинета передаётся всегда (`credentials: 'include'`), поэтому
// вход в личный кабинет работает без хранения токена в браузере. Токен доступа
// нужен только в мастере подачи, пока сессии ещё нет.

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Разворачивает обёртку ответа `{ data, meta }` (ТЗ 05, п. 1.1).
 *
 * Обёртка снимается в одном месте — здесь: остальной код работает с полезной
 * нагрузкой напрямую и не знает о формате транспорта. Если сервер ответил без
 * обёртки (старая сборка), значение возвращается как есть.
 */
function unwrap<T>(payload: unknown): T {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > 0 && keys.every((key) => key === 'data' || key === 'meta')) {
      return record.data as T;
    }
  }
  return payload as T;
}

/** Метаданные последнего списочного ответа: всего записей, страница, размер. */
export interface ListMeta {
  total: number;
  page: number;
  perPage: number;
}

/**
 * Единственное место, где выполняется запрос.
 *
 * Возвращает статус и разобранное тело; разворачивание обёртки и превращение
 * ошибки в ApiError — на уровне request/requestWithMeta, чтобы не дублировать
 * разбор ответа в двух функциях.
 */
async function sendRequest(
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(0, 'Сервер отвечает слишком долго. Проверьте соединение и попробуйте снова.');
    }
    throw new ApiError(0, 'Сервер недоступен. Попробуйте ещё раз через несколько секунд.');
  } finally {
    clearTimeout(timer);
  }
}

/** Превращает тело ошибки в ApiError (ТЗ 05, п. 1.2; читается и старый вид). */
function throwApiError(status: number, payload: unknown): never {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as {
    error?: unknown;
    details?: unknown;
  };
  const error = (typeof body.error === 'object' && body.error !== null ? body.error : {}) as {
    message?: unknown;
    details?: unknown;
  };
  const message =
    typeof body.error === 'string'
      ? body.error
      : typeof error.message === 'string'
        ? error.message
        : 'Не удалось выполнить запрос.';
  const rawDetails = Array.isArray(error.details) ? error.details : body.details;
  const details = Array.isArray(rawDetails) ? rawDetails.map(String) : [];
  throw new ApiError(status, message, details);
}

/**
 * Ответ списка вместе с метаданными: сколько всего записей и какая страница.
 * Экспортируется для экранов, которым нужна постраничность (ТЗ 05, п. 1.4);
 * внутри модуля используется методом `api.newsPage`.
 */
export async function requestWithMeta<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ data: T; meta: ListMeta | null }> {
  const { ok, status, payload } = await sendRequest(path, init, timeoutMs);
  if (!ok) throwApiError(status, payload);
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const meta = (typeof record.meta === 'object' && record.meta !== null ? record.meta : null) as ListMeta | null;
  return { data: unwrap<T>(payload), meta };
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const { ok, status, payload } = await sendRequest(path, init, timeoutMs);
  if (!ok) throwApiError(status, payload);
  return unwrap<T>(payload);
}

function authHeader(accessToken?: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Типы контура эксперта (ТЗ 07, п. 2.5). */
export interface ExpertAssignment {
  team_id: number;
  team_name: string;
  team_status: string;
  direction_title: string | null;
  law_title: string | null;
  act_level: string | null;
  annotation: string | null;
  evaluation_id: number | null;
  total_score: string | number | null;
  scores: Array<{ criterion_id: number; score: number; comment: string | null }> | null;
  comment: string | null;
  recommendations: string | null;
  is_chair_extra: boolean | null;
  is_conflicted: boolean | null;
  conflict_reason: string | null;
  updated_at: string | null;
}

export interface ExpertCriterion {
  id: number;
  code: string | null;
  title: string;
  description: string | null;
  max_score: number;
  sort_order: number;
}

export interface ExpertAssignmentsResponse {
  expert: { id: number; full_name: string; stage: string };
  criteria: ExpertCriterion[];
  teams: ExpertAssignment[];
}

export const expertApi = {
  session: () => request<{ authenticated: boolean; expert?: { id: number; full_name: string; stage: string } }>('/api/expert/session'),
  accessByToken: (token: string) =>
    request<{ success: boolean; expert: { id: number; full_name: string; stage: string } }>('/api/expert/access', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  logout: () => request<{ success: boolean }>('/api/expert/logout', { method: 'POST' }),
  assignments: () => requestWithMeta<ExpertAssignmentsResponse>('/api/expert/assignments'),
  saveEvaluation: (payload: {
    team_id: number;
    scores: Array<{ criterion_id: number; score: number; comment?: string | null }>;
    comment?: string | null;
    recommendations?: string | null;
    is_conflicted?: boolean;
    conflict_reason?: string | null;
  }) =>
    request<{ success: boolean; evaluation_id: number; total_score: number }>('/api/expert/evaluations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const api = {
  // ── Публичные данные ───────────────────────────────────────────────────────
  season: () => request<SeasonResponse>('/api/season/current'),
  directions: () => request<Direction[]>('/api/directions'),

  documents: () => request<PublicDocument[]>('/api/documents'),

  criteria: (stage?: string) => request<PublicCriterion[]>(`/api/criteria${publicQuery({ stage })}`),

  initiatives: (params: { year?: number; direction_id?: number; act_level?: string; has_files?: string; q?: string } = {}) =>
    request<InitiativeListItem[]>(`/api/initiatives${publicQuery(params)}`),

  initiative: (slug: string) => request<InitiativeCard>(`/api/initiatives/${encodeURIComponent(slug)}`),

  winners: (year?: number) => request<Winner[]>(`/api/winners${publicQuery({ year })}`),

  page: (slug: string) => request<PublicPage>(`/api/pages/${encodeURIComponent(slug)}`),

  masterclasses: (params: { status?: 'announced' | 'past' } = {}) =>
    request<PublicMasterclass[]>(`/api/masterclasses${publicQuery(params)}`),

  masterclass: (slug: string) =>
    request<PublicMasterclass>(`/api/masterclasses/${encodeURIComponent(slug)}`),

  experts: () => request<PublicExpert[]>('/api/experts'),

  /** Жюри финального этапа: отдельный справочник со своим составом. */
  jury: () => request<PublicExpert[]>('/api/jury'),

  news: (params: { type?: 'news' | 'video' } = {}) => request<PublicNews[]>(`/api/news${publicQuery(params)}`),

  newsItem: (slug: string) => request<PublicNewsItem>(`/api/news/${encodeURIComponent(slug)}`),

  createLead: (payload: LeadPayload) =>
    request<LeadResult>('/api/leads', { method: 'POST', body: JSON.stringify(payload) }),

  partners: () => request<PublicPartner[]>('/api/partners'),

  // ── Приём заявок ───────────────────────────────────────────────────────────
  createApplication: (payload: CreateApplicationPayload, idempotencyKey: string) =>
    request<ApplicationCreated>('/api/applications', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    }),

  applicationStatus: (publicNumber: string) =>
    request<ApplicationStatus>(`/api/applications/status/${encodeURIComponent(publicNumber)}`),

  materialRequirements: (stage: 'selection' | 'stage1' | 'final' = 'selection') =>
    request<MaterialRequirementsResponse>(`/api/applications/requirements?stage=${stage}`),

  // ── Вход в личный кабинет ──────────────────────────────────────────────────
  cabinetAccessByToken: (token: string) =>
    request<CabinetAccessResponse>('/api/cabinet/access', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  cabinetAccessByNumber: (publicNumber: string, email: string) =>
    request<CabinetAccessResponse>('/api/cabinet/access', {
      method: 'POST',
      body: JSON.stringify({ public_number: publicNumber, email }),
    }),

  cabinetSession: () => request<CabinetSessionResponse>('/api/cabinet/session'),

  cabinetLogout: () => request<{ success: true }>('/api/cabinet/logout', { method: 'POST' }),

  // ── Личный кабинет ─────────────────────────────────────────────────────────
  // accessToken передаётся только мастером подачи: команда ещё не вошла в кабинет.
  cabinetTeam: (accessToken?: string | null) =>
    request<TeamResponse>('/api/cabinet/team', { headers: authHeader(accessToken) }),

  cabinetSaveTeam: (payload: unknown, accessToken?: string | null) =>
    request<{ success: true; team: unknown }>('/api/cabinet/team', {
      method: 'PATCH',
      headers: authHeader(accessToken),
      body: JSON.stringify(payload),
    }),

  cabinetMaterials: (accessToken?: string | null) =>
    request<Material[]>('/api/cabinet/materials', { headers: authHeader(accessToken) }),

  cabinetUploadMaterial: (form: FormData, accessToken?: string | null) =>
    request<{ success: true; id: number; version: number; type: string; type_title: string }>(
      '/api/cabinet/materials',
      { method: 'POST', headers: authHeader(accessToken), body: form },
      60_000
    ),

  cabinetDeleteMaterial: (id: number, accessToken?: string | null) =>
    request<{ success: true }>(`/api/cabinet/materials/${id}`, {
      method: 'DELETE',
      headers: authHeader(accessToken),
    }),

  cabinetDeadlines: (accessToken?: string | null) =>
    request<DeadlinesResponse>('/api/cabinet/deadlines', { headers: authHeader(accessToken) }),

  cabinetSubmit: (payload: SubmitApplicationPayload, accessToken?: string | null) =>
    request<SubmissionResponse>('/api/cabinet/submit', {
      method: 'POST',
      headers: authHeader(accessToken),
      body: JSON.stringify(payload),
    }),

  cabinetContact: (message: string, topic?: string | null, accessToken?: string | null) =>
    request<{ success: true; lead_id: number }>('/api/cabinet/contact', {
      method: 'POST',
      headers: authHeader(accessToken),
      body: JSON.stringify({ message, topic: topic ?? null }),
    }),

  cabinetAppeals: (accessToken?: string | null) =>
    request<Appeal[]>('/api/cabinet/appeals', { headers: authHeader(accessToken) }),

  /**
   * Подача апелляции. Файл передаётся формой: скан прикладывается, если он есть,
   * — апелляцию можно подать и одним текстом (ТЗ 06, п. 2; ТЗ 07, п. 2.9).
   */
  cabinetSubmitAppeal: (
    payload: { stage: 'selection' | 'stage1'; grounds: string; text: string; file?: File | null },
    accessToken?: string | null
  ) => {
    if (payload.file) {
      const form = new FormData();
      form.set('stage', payload.stage);
      form.set('grounds', payload.grounds);
      form.set('text', payload.text);
      form.set('file', payload.file);
      return request<AppealSubmissionResponse>('/api/cabinet/appeals', {
        method: 'POST',
        headers: authHeader(accessToken),
        body: form,
      });
    }
    return request<AppealSubmissionResponse>('/api/cabinet/appeals', {
      method: 'POST',
      headers: authHeader(accessToken),
      body: JSON.stringify({ stage: payload.stage, grounds: payload.grounds, text: payload.text }),
    });
  },

  cabinetFinalConfirmation: (
    payload: { speakers: number[]; note?: string | null },
    accessToken?: string | null
  ) =>
    request<FinalConfirmationResponse>('/api/cabinet/final-confirmation', {
      method: 'POST',
      headers: authHeader(accessToken),
      body: JSON.stringify(payload),
    }),

  cabinetRevokeSessions: (accessToken?: string | null) =>
    request<{ success: true; message?: string }>('/api/cabinet/revoke-sessions', {
      method: 'POST',
      headers: authHeader(accessToken),
    }),

  cabinetWithdraw: (reason: string | null, accessToken?: string | null) =>
    request<WithdrawResponse>('/api/cabinet/withdraw', {
      method: 'POST',
      headers: authHeader(accessToken),
      body: JSON.stringify({ confirm: true, reason }),
    }),

  /**
   * Заполненный бланк заявки (Приложение № 1). Файл тянется как blob, потому что
   * сервер может ответить 503 (нет LibreOffice для PDF) — тогда нужно показать
   * понятное сообщение, а не открывать JSON в новой вкладке.
   */
  cabinetApplicationForm: async (format: 'docx' | 'pdf', accessToken?: string | null): Promise<Blob> => {
    const response = await fetch(`/api/cabinet/application-form.${format}`, {
      credentials: 'include',
      headers: authHeader(accessToken),
    });
    if (!response.ok) {
      let message = 'Не удалось сформировать бланк заявки.';
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
      } catch {
        // Ответ без JSON — оставляем сообщение по умолчанию.
      }
      throw new ApiError(response.status, message);
    }
    return response.blob();
  },
};
