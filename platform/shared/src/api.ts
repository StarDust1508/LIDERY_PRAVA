import type {
  ApplicationCreated,
  ApplicationStatus,
  CabinetAccessResponse,
  CabinetSessionResponse,
  CreateApplicationPayload,
  DeadlinesResponse,
  Direction,
  Material,
  MaterialRequirementsResponse,
  SeasonResponse,
  SubmissionResponse,
  SubmitApplicationPayload,
  TeamResponse,
} from './types';

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

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
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

    if (!response.ok) {
      const body = payload as { error?: unknown; details?: unknown };
      const message = typeof body.error === 'string' ? body.error : 'Не удалось выполнить запрос.';
      const details = Array.isArray(body.details) ? body.details.map(String) : [];
      throw new ApiError(response.status, message, details);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(0, 'Сервер отвечает слишком долго. Проверьте соединение и попробуйте снова.');
    }
    throw new ApiError(0, 'Сервер недоступен. Попробуйте ещё раз через несколько секунд.');
  } finally {
    clearTimeout(timer);
  }
}

function authHeader(accessToken?: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export const api = {
  // ── Публичные данные ───────────────────────────────────────────────────────
  season: () => request<SeasonResponse>('/api/season/current'),
  directions: () => request<Direction[]>('/api/directions'),

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

  cabinetContact: (message: string, accessToken?: string | null) =>
    request<{ success: true; lead_id: number }>('/api/cabinet/contact', {
      method: 'POST',
      headers: authHeader(accessToken),
      body: JSON.stringify({ message }),
    }),
};
