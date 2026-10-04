// Черновик подачи заявки в браузере.
//
// Номер заявки и ссылка доступа сохраняются, пока команда проходит мастер:
// так шаги 2–6 работают без повторного ввода, а после перезагрузки страницы
// прогресс не теряется. Ссылка доступа — секрет: она не попадает в адресную
// строку и удаляется после отправки заявки.

const DRAFT_KEY = 'lp_application_draft_v1';

export interface ApplicationDraftRef {
  public_number: string;
  access_token: string;
  team_name: string;
  created_at: string;
}

export function loadDraft(): ApplicationDraftRef | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ApplicationDraftRef>;
    if (typeof parsed.public_number !== 'string' || typeof parsed.access_token !== 'string') return null;
    return {
      public_number: parsed.public_number,
      access_token: parsed.access_token,
      team_name: typeof parsed.team_name === 'string' ? parsed.team_name : '',
      created_at: typeof parsed.created_at === 'string' ? parsed.created_at : '',
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: ApplicationDraftRef): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Приватный режим браузера может запрещать запись — мастер работает и без неё.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // см. выше
  }
}

/** Ключ идемпотентности: защищает от повторной заявки при двойной отправке. */
export function createIdempotencyKey(): string {
  const random = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `apply-${random}`;
}
