// Типы данных платформы конкурса «Лидеры права – 2027».
// Имена полей совпадают с API (ТЗ 05, п. 7.1: «как в базе», без camelCase).
// Модуль общий для публичной сборки и админки.

export interface Season {
  id: number;
  slug: string;
  title: string;
  year: number;
  status: string;
  is_active: boolean;
  application_open_at: string | null;
  application_close_at: string | null;
  tech_check_from: string | null;
  tech_check_to: string | null;
  stage1_from: string | null;
  stage1_to: string | null;
  final_from: string | null;
  final_to: string | null;
  appeal_window_days: number;
  timezone: string;
  description: string | null;
  is_application_open: boolean;
}

export interface SeasonResponse {
  public_base_url: string;
  season: Season;
  settings: Record<string, unknown>;
}

export interface Direction {
  id: number;
  code: string;
  title: string;
  description: string | null;
  sort_order: number;
}

/** Уровень акта — закрытый перечень Приложения № 1. */
export const ACT_LEVELS = [
  { value: 'federal_constitutional', title: 'Федеральный конституционный закон' },
  { value: 'federal', title: 'Федеральный закон' },
  { value: 'regional', title: 'Закон субъекта Российской Федерации' },
] as const;

export type ActLevel = (typeof ACT_LEVELS)[number]['value'];

export function actLevelTitle(value: string | null | undefined): string {
  return ACT_LEVELS.find((item) => item.value === value)?.title ?? '—';
}

/** Категории участника — пункт 4.1 Положения. */
export const PARTICIPANT_CATEGORIES = [
  { value: 'student', title: 'Студент (бакалавриат, специалитет, СПО)' },
  { value: 'magistrant', title: 'Магистрант' },
  { value: 'aspirant', title: 'Аспирант (адъюнкт)' },
  { value: 'young_specialist', title: 'Молодой специалист' },
  { value: 'mo_leader', title: 'Лидер молодёжного общественного объединения' },
] as const;

export type ParticipantCategory = (typeof PARTICIPANT_CATEGORIES)[number]['value'];

export function participantCategoryTitle(value: string | null | undefined): string {
  return PARTICIPANT_CATEGORIES.find((item) => item.value === value)?.title ?? '—';
}

export interface Participant {
  id: number;
  full_name: string;
  birth_date: string;
  category: string;
  organization: string | null;
  position: string | null;
  education: string | null;
  email: string;
  phone: string | null;
  role: 'captain' | 'member';
  consent_pdn: boolean;
  consent_distribution: boolean;
  consent_legal_representative: boolean;
  is_minor: boolean;
  consent_received: boolean;
  consent_received_at: string | null;
  // Поля Приложения № 1.
  citizenship: string | null;
  region: string | null;
  settlement: string | null;
  vk_url: string | null;
  competencies: string | null;
  personal_contribution: string | null;
  faculty: string | null;
  course: number | null;
  study_program: string | null;
}

export interface Mentor {
  id: number;
  full_name: string;
  organization: string | null;
  position: string | null;
  degree: string | null;
  academic_degree: string | null;
  academic_title: string | null;
  email: string | null;
  phone: string | null;
  consent_pdn: boolean;
  consent_received: boolean;
}

export interface TeamResponse {
  id: number;
  season_id: number;
  season_title: string;
  name: string;
  status: string;
  organization: string | null;
  city: string | null;
  captain_participant_id: number | null;
  direction: { id: number; code: string; title: string } | null;
  application_close_at: string | null;
  is_application_open: boolean;
  /** Номер заявки вида LP-2027-000123: нужен для входа в кабинет. */
  public_number: string | null;
  submitted_at: string | null;
  tech_status: string | null;
  participants: Participant[];
  mentors: Mentor[];
}

export interface Material {
  id: number;
  application_id: number;
  type: string;
  media_id: string | null;
  external_url: string | null;
  version: number;
  status: string;
  reviewer_comment: string | null;
  reviewed_at: string | null;
  fix_deadline: string | null;
  created_at: string;
  updated_at: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  file_url: string | null;
  type_title: string;
  is_deadline_passed: boolean;
  can_delete: boolean;
}

export interface DeadlinesResponse {
  timezone: string;
  application_close_at: string | null;
  stage1_to: string | null;
  appeal_window_days: number;
  is_application_open: boolean;
  milliseconds_left: number;
  fix_deadlines: Array<{
    material_id: number;
    type: string;
    type_title: string;
    fix_deadline: string;
    is_open: boolean;
  }>;
}

/** Ответ на создание заявки. Ссылка доступа показывается один раз. */
export interface ApplicationCreated {
  success: true;
  application_id: number;
  public_number: string;
  team_id: number;
  team_name: string;
  cabinet_url: string;
  access_token: string;
  access_expires_at: string;
  application_close_at: string | null;
  next_step: string;
}

export interface ApplicationStatus {
  public_number: string;
  team_name: string;
  team_status: string;
  tech_status: string;
  submitted: boolean;
  submitted_at: string | null;
  created_at: string;
  participants_count: number;
  mentors_count: number;
  application_close_at: string | null;
}

export interface CabinetAccessResponse {
  success: true;
  team: { id: number; name: string; status: string };
  cabinet_url: string;
}

export interface CabinetSessionResponse {
  authenticated: boolean;
  team?: { id: number; name: string; status: string };
}

export interface SubmissionResponse {
  success: true;
  public_number: string;
  submitted_at: string;
  team_status: string;
  tech_status: string;
  message: string;
}

/** Статусы команды: единая шкала жизненного цикла заявки. */
export const TEAM_STATUS_TITLES: Record<string, string> = {
  draft: 'Черновик',
  submitted: 'На технической проверке',
  tech_check: 'Техническая проверка',
  tech_rejected: 'Требуются исправления',
  allowed: 'Допущена к первому этапу',
  stage1: 'Первый этап',
  finalist: 'Финалист',
  final: 'Второй (финальный) этап',
  winner: 'Победитель',
  disqualified: 'Дисквалифицирована',
  withdrawn: 'Участие отозвано',
};

export function teamStatusTitle(value: string | null | undefined): string {
  return TEAM_STATUS_TITLES[value ?? ''] ?? '—';
}

export const TECH_STATUS_TITLES: Record<string, string> = {
  pending: 'Ожидает проверки',
  in_review: 'Проверяется',
  fix_required: 'Требуются исправления',
  accepted: 'Принята',
  rejected: 'Отклонена',
};

export const MATERIAL_STATUS_TITLES: Record<string, string> = {
  uploaded: 'Загружен',
  accepted: 'Принят',
  needs_fix: 'Требует исправления',
  rejected: 'Отклонён',
};

/** Типы материалов, которые передаются ссылкой, а не файлом. */
export const LINK_ONLY_MATERIAL_TYPES = ['video_link'] as const;

/** Категории согласия на распространение персональных данных (Приложение № 12). */
export const DISTRIBUTION_CATEGORIES = [
  { code: 'full_name', title: 'Фамилия, имя, отчество' },
  { code: 'organization_status', title: 'Образовательная организация или место работы, статус' },
  { code: 'region_settlement', title: 'Субъект Российской Федерации, населённый пункт' },
  { code: 'team_initiative_results', title: 'Команда, инициатива и результаты участия' },
  { code: 'image_voice', title: 'Изображение (фотографии, видеозаписи), голос' },
  { code: 'social_link', title: 'Ссылка на страницу в социальной сети' },
] as const;

export type DistributionCategoryCode = (typeof DISTRIBUTION_CATEGORIES)[number]['code'];

/** Шаги мастера подачи заявки (ТЗ 05, п. 3.2). */
export const MASTER_STEPS = [
  { id: 'team', title: 'Команда и инициатива' },
  { id: 'participants', title: 'Участники' },
  { id: 'mentors', title: 'Наставники' },
  { id: 'materials', title: 'Конкурсные материалы' },
  { id: 'consents', title: 'Согласия' },
  { id: 'review', title: 'Проверка и отправка' },
] as const;

export type MasterStepId = (typeof MASTER_STEPS)[number]['id'];

/** Требование к материалу по этапу (таблица material_requirements). */
export interface MaterialRequirement {
  type: string;
  title: string;
  is_required: boolean;
  due_at: string | null;
  max_files: number;
  allowed_extensions: string[];
  name_template: string | null;
  description: string | null;
  sort_order: number;
}

export interface MaterialRequirementsResponse {
  stage: string;
  application_close_at: string | null;
  requirements: MaterialRequirement[];
}

/** Тело запроса на создание заявки. */
export interface CreateApplicationPayload {
  team: {
    name: string;
    direction_id: number;
    organization?: string | null;
    city?: string | null;
  };
  initiative: {
    law_title: string;
    act_level: ActLevel;
    proposed_initiator?: string | null;
    annotation: string;
    ai_usage?: boolean;
    ai_usage_purpose?: string | null;
    is_solo?: boolean;
    solo_approved_at?: string | null;
  };
  captain: {
    full_name: string;
    birth_date: string;
    category: ParticipantCategory;
    email: string;
    phone?: string | null;
  };
}

/** Тело запроса на отправку заявки. */export interface SubmitApplicationPayload {
  confirm_regulation: boolean;
  image_license: boolean;
  distribution?: Array<{
    participant_id: number;
    categories: Partial<Record<DistributionCategoryCode, boolean>>;
    conditions?: string | null;
  }>;
}
