import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink , Navigate } from 'react-router-dom';
import {
  APPEAL_GROUNDS,
  APPEAL_STATUS_TITLES,
  ApiError,
  type Appeal,
  type DeadlinesResponse,
  type Material,
  type MaterialRequirement,
  type TeamResponse,
  api,
  formatFileSize,
  formatMoscowDate,
  formatMoscowHuman,
  formatTimeLeft,
} from '@shared/index';
import { Alert, Button, SectionCard, SelectField, TextAreaField } from '@shared/index';
import { saveBlob } from '@/lib/download';

// Общая логика и общие блоки разделов личного кабинета команды (ТЗ 06).
//
// Файл держит три вещи, которые иначе пришлось бы повторять на каждом экране:
//   1) загрузку данных команды, сроков, материалов и требований к комплекту;
//   2) каркас личного кабинета — постоянную навигацию по разделам и сводные действия;
//   3) справочники статусов и правила «что и когда можно менять» (ТЗ 06, п. 3).
// Проверки прав и сроков выполняет сервер: интерфейс лишь объясняет причину
// заранее, чтобы команда не упиралась в отказ после нажатия кнопки.

// ── Данные личного кабинета ──────────────────────────────────────────────────────────

export interface CabinetData {
  team: TeamResponse;
  deadlines: DeadlinesResponse;
  materials: Material[];
  /** Требования к комплекту отборочного этапа: форматы, объём, сроки, шаблон имени. */
  requirements: MaterialRequirement[];
}

/**
 * Данные личного кабинета. Сессия проверяется первой: при 401 страница показывает
 * объяснение и ссылку на вход, а не пустой экран (ТЗ 06, п. 5.3).
 */
export async function fetchCabinetData(): Promise<CabinetData> {
  const session = await api.cabinetSession();
  if (!session.authenticated) {
    throw new ApiError(401, 'Сессия личного кабинета не действует.');
  }
  const [team, deadlines, materials, requirementsResponse] = await Promise.all([
    api.cabinetTeam(),
    api.cabinetDeadlines(),
    api.cabinetMaterials(),
    api.materialRequirements('selection'),
  ]);
  return { team, deadlines, materials, requirements: requirementsResponse.requirements };
}

/** Перезагрузка без повторной проверки сессии: сессия уже подтверждена. */
export async function fetchCabinetDataOnly(): Promise<Omit<CabinetData, 'team'>> {
  const [deadlines, materials, requirementsResponse] = await Promise.all([
    api.cabinetDeadlines(),
    api.cabinetMaterials(),
    api.materialRequirements('selection'),
  ]);
  return { deadlines, materials, requirements: requirementsResponse.requirements };
}

// ── Статусы и правила ────────────────────────────────────────────────────────

/** Понятный статус заявки и что будет дальше (ТЗ 06, п. 2, блок «Статус заявки»). */
export function applicationStatusText(data: CabinetData): { title: string; next: string } {
  const { team, deadlines } = data;
  switch (team.status) {
    case 'draft':
      return {
        title: 'Черновик: заявка ещё не отправлена',
        next: team.submitted_at
          ? 'Заявка сохранена. Дождитесь подтверждения отправки.'
          : 'Заполните оставшиеся шаги мастера подачи и отправьте заявку — до отправки она в техническую проверку не попадает.',
      };
    case 'submitted':
    case 'tech_check':
      return {
        title: 'Заявка подана, идёт техническая проверка',
        next: deadlines.application_close_at
          ? `Техническая проверка завершится после окончания приёма заявок — ${formatMoscowHuman(deadlines.application_close_at)}. Итоги появятся здесь.`
          : 'Техническая проверка завершится после окончания приёма заявок. Итоги появятся здесь.',
      };
    case 'tech_rejected':
      return {
        title: 'Нужны исправления по замечаниям технической проверки',
        next: 'Исправьте материалы и состав по замечаниям ниже. Работа с материалами открыта до срока досдачи.',
      };
    case 'allowed':
      return {
        title: 'Команда допущена к первому этапу',
        next: 'Подготовьте видеоролик и материалы первого этапа: требования и сроки — в разделе «Дедлайны».',
      };
    case 'stage1':
      return {
        title: 'Идёт первый этап',
        next: 'Оргкомитет оценивает материалы первого этапа. Итоги и протокол появятся здесь.',
      };
    case 'finalist':
      return {
        title: 'Команда вышла в финал',
        next: 'Подтвердите состав выступающих в разделе «Финал» и загрузите презентационные материалы.',
      };
    case 'final':
      return {
        title: 'Идёт второй (финальный) этап',
        next: 'Проверьте состав выступающих и презентационные материалы. Итоги финала появятся здесь.',
      };
    case 'winner':
      return {
        title: 'Команда — победитель конкурса',
        next: 'Итоги опубликованы. Материалы и бланк заявки остаются доступны для скачивания.',
      };
    case 'disqualified':
      return {
        title: 'Команда дисквалифицирована',
        next: 'Решение Оргкомитета можно обсудить по контактам раздела «Помощь».',
      };
    case 'withdrawn':
      return {
        title: 'Участие отозвано',
        next: 'Согласия отозваны, доступ по ссылке закрыт. Чтобы вернуться, напишите в Оргкомитет.',
      };
    default:
      return { title: 'Статус заявки уточняется', next: 'Обновите страницу через несколько минут.' };
  }
}

/** Причина, по которой изменение состава запрещено, или null, если разрешено. */
export function teamEditBlockReason(data: CabinetData): string | null {
  const { team } = data;
  if (team.status === 'withdrawn' || team.status === 'disqualified') {
    return 'Участие команды прекращено: изменение состава недоступно. Обратитесь в Оргкомитет.';
  }
  if (!team.is_application_open) {
    return team.application_close_at
      ? `Приём заявок завершён ${formatMoscowHuman(team.application_close_at)}. Изменение состава после этого срока — только по обращению в Оргкомитет.`
      : 'Приём заявок завершён. Изменение состава — только по обращению в Оргкомитет.';
  }
  if (team.status !== 'draft' && team.status !== 'tech_rejected') {
    return `Состав нельзя изменить: ${applicationStatusText(data).title.toLowerCase()}. Изменение возможно в черновике и при исправлении замечаний — в остальных случаях обратитесь в Оргкомитет через раздел «Помощь».`;
  }
  return null;
}

/** Причина, по которой изменение данных участника запрещено, или null. */
export function participantEditBlockReason(data: CabinetData): string | null {
  if (!data.team.is_application_open) {
    return data.team.application_close_at
      ? `Приём заявок завершён ${formatMoscowHuman(data.team.application_close_at)}. После этого срока исправления — только по обращению в Оргкомитет.`
      : 'Приём заявок завершён. Исправления — только по обращению в Оргкомитет.';
  }
  return null;
}

/** Сообщение режима «дедлайн пропущен» (ТЗ 06, п. 4.2). */
export function deadlinePassedMessage(data: CabinetData): string {
  const closeAt = data.deadlines.application_close_at ?? data.team.application_close_at;
  const date = closeAt ? formatMoscowDate(closeAt) : 'установленная дата';
  return `Срок приёма материалов отборочного этапа истёк ${date}. Изменение материалов после срока не допускается (п. 7.5 Положения).`;
}

/** Срок досдачи по замечанию для конкретного материала. */
export function fixDeadlineFor(data: CabinetData, material: Material): string | null {
  if (material.fix_deadline) return material.fix_deadline;
  const match = data.deadlines.fix_deadlines.find((item) => item.material_id === material.id);
  return match?.fix_deadline ?? null;
}

// ── Комплект материалов по требованиям ───────────────────────────────────────

export type KitState = 'accepted' | 'in_review' | 'needs_fix' | 'missing' | 'optional';

export const KIT_STATE_TITLES: Record<KitState, string> = {
  accepted: 'сдан',
  in_review: 'на проверке',
  needs_fix: 'нужны исправления',
  missing: 'не сдан',
  optional: 'не обязателен',
};

export const KIT_STATE_TONES: Record<KitState, string> = {
  accepted: 'border-success text-success',
  in_review: 'border-warning text-warning',
  needs_fix: 'border-danger text-danger',
  missing: 'border-border-strong text-muted',
  optional: 'border-border text-muted',
};

export interface KitItem {
  requirement: MaterialRequirement | null;
  title: string;
  /** Все версии материала этого типа, от новой к старой. */
  versions: Material[];
  /** Актуальная версия: с ней работает команда. */
  current: Material | null;
  required: boolean;
  state: KitState;
  deadline: string | null;
}

/** Статус одного типа материала по правилам ТЗ 06, п. 2. */
/**
 * Состояние материала определяется последней версией, а не любой из загруженных.
 * Иначе команда, перезагрузившая материал по замечанию, навсегда видела бы
 * «нужны исправления» из-за старой версии, а принятая версия перекрывала бы
 * новую, ещё не проверенную.
 */
function kitStateOf(versions: Material[]): KitState {
  if (versions.length === 0) return 'missing';
  const latest = versions[0];
  if (!latest) return 'missing';
  if (latest.status === 'accepted') return 'accepted';
  if (latest.status === 'needs_fix' || latest.status === 'rejected' || latest.status === 'blocked') {
    return 'needs_fix';
  }
  return 'in_review';
}

/**
 * Материалы, которые система формирует сама (заявка по Приложению № 1 и
 * согласия в мастере). Их нельзя загрузить файлом, поэтому в комплекте они
 * не должны считаться «не сданными»: иначе прогресс навсегда замирает на
 * «сдано 3 из 4», а команда ищет кнопку загрузки, которой нет.
 */
const AUTO_MATERIAL_TYPES = ['application_form', 'consent_pdn', 'consent_legal_rep'] as const;

export function isAutoMaterial(type: string): boolean {
  return (AUTO_MATERIAL_TYPES as readonly string[]).includes(type);
}

/** Автоматический материал уже выполнен по данным команды. */
function autoMaterialSatisfied(data: CabinetData, type: string, hasMinor: boolean): boolean {
  const participants = data.team.participants;
  if (type === 'application_form') return Boolean(data.team.public_number || data.team.id);
  if (type === 'consent_pdn') {
    return participants.length > 0 && participants.every((participant) => participant.consent_pdn);
  }
  if (type === 'consent_legal_rep') {
    return (
      !hasMinor ||
      participants
        .filter((participant) => participant.is_minor)
        .every((participant) => participant.consent_legal_representative)
    );
  }
  return false;
}

/** Пояснение в таблице комплекта вместо «файл не загружен». */
export function autoMaterialNote(type: string): string | null {
  if (type === 'application_form') return 'формируется системой';
  if (type === 'consent_pdn') return 'оформлены электронно';
  if (type === 'consent_legal_rep') return 'оформляется в мастере';
  return null;
}

/**
 * Комплект отборочного этапа: обязательные и условные материалы, статусы и
 * сроки. Материалы, загруженные вне списка требований, показываются отдельной
 * строкой — молча терять их нельзя.
 */
export function buildKit(data: CabinetData, hasMinor: boolean): KitItem[] {
  const items: KitItem[] = data.requirements.map((requirement) => {
    const versions = data.materials
      .filter((material) => material.type === requirement.type)
      .sort((a, b) => b.version - a.version);
    const auto = isAutoMaterial(requirement.type);
    const satisfied = auto && autoMaterialSatisfied(data, requirement.type, hasMinor);
    const required =
      !satisfied && (requirement.is_required || (requirement.type === 'consent_legal_rep' && hasMinor));
    const state = satisfied
      ? 'accepted'
      : versions.length === 0 && !required
        ? 'optional'
        : kitStateOf(versions);
    return {
      requirement,
      title: requirement.title,
      versions,
      current: versions[0] ?? null,
      required,
      state,
      deadline: requirement.due_at ?? data.deadlines.application_close_at,
    };
  });

  const known = new Set(data.requirements.map((item) => item.type));
  const extraTypes = [...new Set(data.materials.map((material) => material.type))].filter(
    (type) => !known.has(type)
  );
  for (const type of extraTypes) {
    const versions = data.materials
      .filter((material) => material.type === type)
      .sort((a, b) => b.version - a.version);
    items.push({
      requirement: null,
      title: versions[0]?.type_title ?? type,
      versions,
      current: versions[0] ?? null,
      required: false,
      state: kitStateOf(versions),
      deadline: data.deadlines.application_close_at,
    });
  }

  return items;
}

/** Прогресс комплекта: сколько обязательных материалов уже сдано. */
export function kitProgress(items: KitItem[]): { done: number; total: number; needsFix: number } {
  const required = items.filter((item) => item.required);
  return {
    // «Сдано» — материал загружен и ждёт проверки или уже принят. Иначе после
    // загрузки команда видела бы «0 из 4» до решения Оргкомитета.
    done: required.filter((item) => item.state === 'accepted' || item.state === 'in_review').length,
    total: required.length,
    needsFix: required.filter((item) => item.state === 'needs_fix').length,
  };
}

/** Участник младше 18 лет: по нему нужен скан согласия законного представителя. */
export function teamHasMinor(team: TeamResponse): boolean {
  return team.participants.some((participant) => participant.is_minor);
}

// ── Обратный отсчёт ──────────────────────────────────────────────────────────

/**
 * Обратный отсчёт по МСК. Считается от миллисекунд, отданных сервером, и
 * обновляется раз в минуту: чаще не нужно, а «замирание» вкладки не мешает.
 */
export function useCountdown(millisecondsLeft: number): { left: number; text: string } {
  const [left, setLeft] = useState(millisecondsLeft);

  useEffect(() => {
    setLeft(millisecondsLeft);
    if (millisecondsLeft <= 0) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setLeft(Math.max(0, millisecondsLeft - (Date.now() - startedAt)));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [millisecondsLeft]);

  return { left, text: formatTimeLeft(left) };
}

// ── Каркас раздела ───────────────────────────────────────────────────────────

/**
 * Раздел личного кабинета: заголовок блока, необязательное пояснение и содержимое.
 * Ниже — «шапка» состояния: запрет на изменение объясняется всегда, а не
 * только после отказа сервера (ТЗ 06, п. 3).
 */
export function CabinetSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <SectionCard title={title} description={description}>
      {children}
    </SectionCard>
  );
}

/**
 * Пояснение к заблокированному действию: причина и срок. Показывается рядом
 * с неактивной кнопкой — так действие не исчезает молча.
 */
export function LockedNote({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p className="border border-border bg-surface px-4 py-3 text-sm text-muted">{reason}</p>
  );
}

/** Состояние загрузки раздела: текст, а не пустой экран. */
export function CabinetLoading({ label = 'Загружаем данные команды…' }: { label?: string }) {
  return (
    <p role="status" className="text-sm text-muted">
      {label}
    </p>
  );
}

/** Сессия недействительна: объяснение и способ получить доступ заново. */
export function CabinetSessionLost() {
  // Требование заказчика от 23.10.2026: по кнопке «Личный кабинет» человек
  // попадает сразу на вход, а не на страницу «сессия недействительна».
  return <Navigate to="/cabinet/access" replace />;
}

/** Ошибка загрузки данных, не связанная с сессией: текст и повтор. */
export function CabinetLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Alert tone="danger" title="Не удалось загрузить данные личного кабинета">
        {message}
      </Alert>
      <Button variant="secondary" onClick={onRetry}>
        Обновить
      </Button>
    </div>
  );
}

// ── Диалог подтверждения ─────────────────────────────────────────────────────

/**
 * Диалог подтверждения необратимого действия. Реализован на нативном
 * `dialog.showModal()`: браузер сам удерживает фокус внутри, закрывает по Esc и
 * возвращает фокус на кнопку вызова (ТЗ 08, п. 7.1).
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="w-[min(560px,92vw)] border border-border-strong bg-raised p-0 text-fg backdrop:bg-[color-mix(in_srgb,var(--ink)_40%,transparent)]"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-h2 font-semibold">
          {title}
        </h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5 text-sm">{children}</div>
      <div className="flex flex-wrap gap-3 border-t border-border px-5 py-4">
        <Button variant={tone === 'danger' ? 'primary' : 'secondary'} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Отменить
        </Button>
      </div>
    </dialog>
  );
}

// ── Каркас личного кабинета: навигация по разделам ───────────────────────────────────

interface CabinetSectionLink {
  to: string;
  title: string;
  /** Краткая подпись раздела: что команда там делает. */
  hint: string;
  /** Причина недоступности: раздел показывается, но неактивен (ТЗ 06, п. 3). */
  lockedReason: string | null;
}

/**
 * Постоянная навигация личного кабинета. «Финал» видят только финалисты: остальным
 * пункт показан неактивным с пояснением причины, а не удалён.
 */
function CabinetNav({
  isFinalist,
  finalLockedReason,
  progress,
}: {
  isFinalist: boolean;
  finalLockedReason: string;
  progress: { done: number; total: number };
}) {
  const sections: CabinetSectionLink[] = [
    { to: '/cabinet', title: 'Сводка', hint: 'Статус заявки и что делать дальше', lockedReason: null },
    { to: '/cabinet/team', title: 'Команда', hint: 'Состав, капитан команды, наставники', lockedReason: null },
    {
      to: '/cabinet/materials',
      title: 'Конкурсные материалы',
      hint: progress.total > 0 ? `Комплект: сдано ${progress.done} из ${progress.total}` : 'Комплект отборочного этапа',
      lockedReason: null,
    },
    { to: '/cabinet/deadlines', title: 'Дедлайны', hint: 'Этапы конкурса и сроки', lockedReason: null },
    { to: '/cabinet/help', title: 'Помощь', hint: 'Контакты Оргкомитета и обращение', lockedReason: null },
    {
      to: '/cabinet/final',
      title: 'Финал',
      hint: 'Подтверждение участия и выступающие',
      lockedReason: isFinalist ? null : finalLockedReason,
    },
  ];

  return (
    <nav aria-label="Разделы личного кабинета" className="border border-border bg-surface">
      <p className="mono-label hidden border-b border-border px-5 py-3 text-muted lg:block">Разделы личного кабинета</p>
      {/* На телефоне — горизонтальная лента: список с подписями занимал почти
          весь первый экран, и до содержимого раздела было не добраться. */}
      <ul className="flex flex-wrap gap-2 p-2 lg:flex-col lg:flex-nowrap lg:gap-0 lg:p-0">
        {sections.map((section) => (
          <li key={section.to} className="shrink-0 border-b-0 lg:border-b lg:border-border lg:last:border-b-0">
            {section.lockedReason === null ? (
              <NavLink
                to={section.to}
                end={section.to === '/cabinet'}
                className={({ isActive }) =>
                  `flex flex-col gap-1 whitespace-nowrap border px-3 py-2 text-sm lg:whitespace-normal lg:border-0 lg:px-5 lg:py-3 lg:hover:bg-raised ${
                    isActive
                      ? 'border-accent bg-raised font-medium text-fg lg:border-l-2 lg:border-l-accent lg:border-y-0 lg:border-r-0'
                      : 'border-transparent text-muted'
                  }`
                }
              >
                <span>{section.title}</span>
                <span className="hidden text-sm text-muted lg:block">{section.hint}</span>
              </NavLink>
            ) : (
              <div aria-disabled="true" className="flex flex-col gap-1 px-3 py-2 text-sm lg:px-5 lg:py-3">
                <span className="text-muted">{section.title}</span>
                <span className="hidden text-sm text-muted lg:block">
                  {section.hint} — {section.lockedReason}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Пояснение к разделу «Финал» для команд, которые ещё не стали финалистами. */
export function finalLockedText(data: CabinetData): string {
  switch (data.team.status) {
    case 'finalist':
    case 'final':
    case 'winner':
      return '';
    case 'withdrawn':
    case 'disqualified':
      return 'участие команды прекращено';
    case 'tech_rejected':
      return 'раздел откроется после исправлений и публикации итогов первого этапа';
    default:
      return 'раздел откроется после публикации итогов первого этапа';
  }
}

/**
 * Каркас личного кабинета: заголовок команды, навигация по разделам, сводные действия
 * (скачивание бланка заявки, завершение сеансов, отказ от участия) и место для
 * содержимого раздела. С любой страницы личного кабинета есть возврат к сводке.
 */
export function CabinetLayout({
  data,
  title,
  lead,
  onReload,
  toolbarExtra,
  children,
}: {
  data: CabinetData;
  title: string;
  lead?: string;
  onReload: () => Promise<void> | void;
  toolbarExtra?: ReactNode;
  children: ReactNode;
}) {
  const kit = buildKit(data, teamHasMinor(data.team));
  const progress = kitProgress(kit);
  const isFinalist =
    data.team.status === 'finalist' || data.team.status === 'final' || data.team.status === 'winner';

  return (
    <>
      {/* Шапка сайта внутри кабинета: человек не должен чувствовать, что
          попал на другой сайт (просьба заказчика от 24.10.2026). */}
      <div className="site cabinet-topbar">
        <header className="topbar">
          <div className="topbar-inner wrap">
            <Link to="/" className="topbar-mark">
              <img src="/assets/logo-classic-128.png" alt="" width={32} height={32} />
              <span className="topbar-word">Лидеры&nbsp;права</span>
            </Link>
            <nav className="topbar-links" aria-label="Ключевые разделы">
              <Link to="/">Главная</Link>
              <Link to="/about">О конкурсе</Link>
              <Link to="/stages">Этапы</Link>
              <Link to="/documents">Документы</Link>
            </nav>
            <div className="topbar-actions">
              <Link to="/apply" className="topbar-apply">
                <span>Подать заявку</span>
              </Link>
            </div>
          </div>
        </header>
      </div>

      {/* Кабинет живёт вне общей обёртки сайта: без контейнера содержимое
          прилипало к краям экрана, а на телефоне уезжало за вьюпорт. */}
      <div className="mx-auto w-full max-w-container px-5 py-8 lg:px-8 lg:py-10">
      <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
        <CabinetNav
          isFinalist={isFinalist}
          finalLockedReason={finalLockedText(data)}
          progress={progress}
        />
        <CabinetToolbar data={data} onReload={onReload} extra={toolbarExtra} />
      </div>

      <main className="flex min-w-0 flex-col gap-8">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <p className="text-2xl font-extrabold uppercase tracking-[-0.02em] sm:text-3xl">Личный кабинет</p>
          <img
            src="/assets/logo-ten-600.png"
            alt="Юбилейный знак конкурса"
            className="h-10 w-auto sm:h-12"
            width={600}
            height={432}
          />
        </div>
        <header className="border-b border-border pb-6">
          <p className="mono-label text-muted">
            {data.team.public_number ? `Заявка ${data.team.public_number}` : 'Личный кабинет'}
          </p>
          <h1 className="mt-2 max-w-measure text-h1 font-semibold tracking-[var(--tr-heading)]">{title}</h1>
          {lead ? <p className="mt-4 max-w-measure text-lead text-muted">{lead}</p> : null}
        </header>
        {title !== 'Сводка' ? (
          <p className="text-sm">
            <Link to="/cabinet" className="text-accent underline underline-offset-2">
              Вернуться к сводке личного кабинета
            </Link>
          </p>
        ) : null}
        {children}
      </main>
      </div>
      </div>
    </>
  );
}

// ── Сводные действия личного кабинета ────────────────────────────────────────────────

/**
 * Действия, доступные с любого экрана личного кабинета: бланк заявки (Приложение № 1),
 * завершение всех сеансов (ТЗ 06, п. 7.4) и отказ от участия (п. 4.10).
 */
function CabinetToolbar({
  data,
  onReload,
  extra,
}: {
  data: CabinetData;
  onReload: () => Promise<void> | void;
  extra?: ReactNode;
}) {
  const [formBusy, setFormBusy] = useState<'docx' | 'pdf' | null>(null);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeNotice, setRevokeNotice] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawNotice, setWithdrawNotice] = useState<string | null>(null);

  const participationClosed =
    data.team.status === 'withdrawn' || data.team.status === 'disqualified';

  async function download(format: 'docx' | 'pdf') {
    setFormError(null);
    setFormBusy(format);
    try {
      const blob = await api.cabinetApplicationForm(format);
      const number = data.team.public_number ?? 'lidery-prava';
      saveBlob(blob, `zayavka-${number}.${format}`);
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? caught.message
          : 'Не удалось сформировать бланк заявки. Попробуйте ещё раз.'
      );
    } finally {
      setFormBusy(null);
    }
  }

  /** Бланк согласия для архива: Приложения № 10–13 (ТЗ 06, п. 1.3). */
  async function downloadConsent(kind: 'pdn' | 'distribution' | 'legal_representative' | 'media') {
    setFormError(null);
    setConsentBusy(kind);
    try {
      const blob = await api.cabinetConsentForm(kind);
      saveBlob(blob, `soglasie-${kind}.docx`);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Не удалось сформировать бланк согласия.');
    } finally {
      setConsentBusy(null);
    }
  }

  async function revokeSessions() {
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const response = await api.cabinetRevokeSessions();
      setRevokeNotice(
        response.message ??
          'Все сеансы личного кабинета завершены. Чтобы войти снова, воспользуйтесь ссылкой доступа или запросите её у Оргкомитета.'
      );
      setRevokeOpen(false);
    } catch (caught) {
      setRevokeError(
        caught instanceof ApiError ? caught.message : 'Не удалось завершить сеансы. Попробуйте ещё раз.'
      );
    } finally {
      setRevokeBusy(false);
    }
  }

  async function withdraw() {
    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      const response = await api.cabinetWithdraw(withdrawReason.trim() || null);
      setWithdrawOpen(false);
      setWithdrawReason('');
      setWithdrawNotice(response.message);
      await onReload();
    } catch (caught) {
      setWithdrawError(
        caught instanceof ApiError ? caught.message : 'Не удалось отказаться от участия. Попробуйте ещё раз.'
      );
    } finally {
      setWithdrawBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {revokeNotice ? <Alert tone="success">{revokeNotice}</Alert> : null}
      {withdrawNotice ? <Alert tone="warning">{withdrawNotice}</Alert> : null}
      {formError ? <Alert tone="warning">{formError}</Alert> : null}
      {extra}

      <details className="border border-border bg-surface">
        <summary className="mono-label cursor-pointer px-4 py-3 text-muted">Бланк заявки</summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted">
            Приложение №&nbsp;1 заполнено данными команды: скачайте для архива, загружать в комплект не нужно.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={formBusy === 'docx'}
              disabled={formBusy !== null}
              onClick={() => void download('docx')}
            >
              Скачать DOCX
            </Button>
            <Button
              variant="secondary"
              loading={formBusy === 'pdf'}
              disabled={formBusy !== null}
              onClick={() => void download('pdf')}
            >
              Скачать PDF
            </Button>
          </div>
        </div>
      </details>

      {/* Бланки согласий (Приложения № 10–13): согласия даны электронно, но
          команда может скачать заполненные бланки для архива или подписания
          (ТЗ 06, п. 1.3). */}
      <details className="border border-border bg-surface">
        <summary className="mono-label cursor-pointer px-4 py-3 text-muted">Бланки согласий</summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted">
            Согласия оформлены электронно; бланки заполнены данными участников — можно скачать для архива или
            подписать. Для участников младше 18 лет скан Приложения&nbsp;№&nbsp;11 загружается в комплект.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={consentBusy === 'pdn'}
              disabled={consentBusy !== null}
              onClick={() => void downloadConsent('pdn')}
            >
              Согласие на обработку (№ 10)
            </Button>
            <Button
              variant="secondary"
              loading={consentBusy === 'distribution'}
              disabled={consentBusy !== null}
              onClick={() => void downloadConsent('distribution')}
            >
              Согласие на распространение (№ 12)
            </Button>
            <Button
              variant="secondary"
              loading={consentBusy === 'legal_representative'}
              disabled={consentBusy !== null}
              onClick={() => void downloadConsent('legal_representative')}
            >
              Согласие законного представителя (№ 11)
            </Button>
            <Button
              variant="secondary"
              loading={consentBusy === 'media'}
              disabled={consentBusy !== null}
              onClick={() => void downloadConsent('media')}
            >
              Изображение и материалы (№ 13)
            </Button>
          </div>
        </div>
      </details>

      <details className="border border-border bg-surface">
        <summary className="mono-label cursor-pointer px-4 py-3 text-muted">Доступ и участие</summary>
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => setRevokeOpen(true)}>
              Завершить все сеансы
            </Button>
            <p className="text-sm text-muted">
              Завершает вход во всех браузерах. Понадобится снова войти по номеру заявки или по ссылке доступа.
            </p>
            {revokeError ? (
              <p role="alert" className="text-sm text-danger">
                {revokeError}
              </p>
            ) : null}
          </div>

          {participationClosed ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">Отказ от участия недоступен: участие команды уже прекращено.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button variant="quiet" onClick={() => setWithdrawOpen(true)}>
                Отказаться от участия
              </Button>
              <p className="text-sm text-muted">
                Отказ возможен на любом этапе (п. 4.10 Положения) и отзывает согласия на обработку персональных
                данных (п. 14.3).
              </p>
              {withdrawError ? (
                <p role="alert" className="text-sm text-danger">
                  {withdrawError}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </details>

      <ConfirmDialog
        open={revokeOpen}
        title="Завершить все сеансы личного кабинета?"
        confirmLabel="Завершить все сеансы"
        busy={revokeBusy}
        onConfirm={() => void revokeSessions()}
        onClose={() => setRevokeOpen(false)}
      >
        <p>
          Все выданные сеансы перестанут действовать, в том числе в других браузерах и на других устройствах.
          Текущая страница тоже потеряет доступ, пока команда не войдёт заново.
        </p>
        <p className="text-muted">
          Ссылка доступа при этом не сгорает: Оргкомитет может выдать её заново, а вход по номеру заявки и почте
          капитана команды продолжит работать.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={withdrawOpen}
        title="Отказаться от участия в конкурсе?"
        confirmLabel="Отказаться от участия"
        busy={withdrawBusy}
        onConfirm={() => void withdraw()}
        onClose={() => setWithdrawOpen(false)}
      >
        <p>
          Действие необратимо в интерфейсе: заявка получает статус «Участие отозвано», согласия на обработку
          персональных данных отзываются, а ссылки доступа закрываются (п. 14.3 Положения).
        </p>
        <p className="text-muted">
          Вернуться к участию можно только через Оргкомитет — раздел «Помощь».
        </p>
        <TextAreaField
          id="withdraw-reason"
          label="Причина отказа (по желанию)"
          value={withdrawReason}
          onChange={(event) => setWithdrawReason(event.target.value)}
          maxLength={1000}
          hint="Причина попадает в карточку команды: она помогает Оргкомитету понять, что помешало участию."
        />
      </ConfirmDialog>
    </div>
  );
}

// ── Обращение в Оргкомитет ───────────────────────────────────────────────────

const CABINET_CONTACT_TOPICS = [
  { value: 'general', title: 'Общий вопрос о конкурсе' },
  { value: 'application', title: 'Вопрос по заявке или материалам' },
  { value: 'access', title: 'Доступ в личный кабинет' },
  { value: 'deadline', title: 'Связь по дедлайну: срок пропущен' },
  { value: 'appeal', title: 'Апелляция по итогам этапа' },
];

/**
 * Обращение в Оргкомитет. Тема выбирается из перечня, чтобы команда могла
 * явно указать связь по дедлайну; для этого тема добавляется первой строкой
 * обращения. Название команды и статус заявки сервер прикладывает сам.
 */
export function CabinetContactForm({
  showTopic = false,
  defaultTopic = 'general',
  compactNote,
  onSent,
}: {
  showTopic?: boolean;
  defaultTopic?: string;
  compactNote?: string;
  onSent?: () => void;
}) {
  const [message, setMessage] = useState('');
  const [topic, setTopic] = useState(defaultTopic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const body = message.trim();
    if (body === '') {
      setError('Опишите вопрос: Оргкомитет ответит на адрес электронной почты капитана команды.');
      return;
    }
    // Тема уходит отдельным полем: по ней Оргкомитет фильтрует обращения
    // (в том числе связь после дедлайна — ТЗ 06, п. 4.4), а текст остаётся
    // текстом обращения, без служебной первой строки.
    const topicTitle = CABINET_CONTACT_TOPICS.find((item) => item.value === topic)?.title ?? null;

    setBusy(true);
    try {
      await api.cabinetContact(body, showTopic ? topicTitle : null);
      setMessage('');
      setNotice('Обращение отправлено. Оргкомитет ответит на адрес электронной почты капитана команды.');
      onSent?.();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Не удалось отправить обращение. Попробуйте ещё раз.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      {error ? (
        <Alert tone="danger" title="Обращение не отправлено">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {showTopic ? (
        <SelectField
          id="contact-topic"
          label="Тема обращения"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          options={CABINET_CONTACT_TOPICS}
          hint="Если срок уже истёк, выберите «Связь по дедлайну»: обращение попадёт в очередь на досдачу."
        />
      ) : null}

      <TextAreaField
        id="contact-message"
        label="Текст обращения"
        required
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={5000}
        error={error ? 'Проверьте текст обращения.' : undefined}
        hint={
          compactNote ??
          'Оргкомитет ответит на адрес электронной почты капитана команды. К обращению автоматически прикладываются название команды и статус заявки.'
        }
      />

      <div>
        <Button type="submit" loading={busy} disabled={message.trim() === ''}>
          Отправить обращение
        </Button>
      </div>
    </form>
  );
}

// ── Апелляция по итогам этапа ───────────────────────────────────────────────

/**
 * Апелляция по форме Приложения № 14 (п. 12.1 Положения). Подаётся капитаном
 * команды в течение двух рабочих дней с момента опубликования протокола этапа;
 * срок считает сервер по фактическому времени публикации.
 */
export function CabinetAppealForm({ data }: { data: CabinetData }) {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [appealsLoaded, setAppealsLoaded] = useState(false);
  const [stage, setStage] = useState<'selection' | 'stage1'>('selection');
  const [grounds, setGrounds] = useState<string>(APPEAL_GROUNDS[0].value);
  const [text, setText] = useState('');
  // Скан прикладывается по желанию: апелляцию можно подать и одним текстом.
  const [scan, setScan] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .cabinetAppeals()
      .then((rows) => {
        if (active) setAppeals(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setAppealsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const participationClosed = data.team.status === 'withdrawn' || data.team.status === 'disqualified';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (text.trim() === '') {
      setError('Изложите мотивированное обоснование со ссылками на Положение.');
      return;
    }
    setBusy(true);
    try {
      const response = await api.cabinetSubmitAppeal({ stage, grounds, text: text.trim(), file: scan });
      setText('');
      setScan(null);
      setNotice(`Апелляция подана. Срок рассмотрения — до ${formatMoscowHuman(response.deadline_at)}.`);
      setAppeals(await api.cabinetAppeals().catch(() => appeals));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось подать апелляцию. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!appealsLoaded ? (
        <p role="status" className="text-sm text-muted">
          Загружаем сведения об апелляциях…
        </p>
      ) : appeals.length === 0 ? (
        <p className="text-sm text-muted">Апелляций команда не подавала.</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {appeals.map((appeal) => (
            <li key={appeal.id} className="border border-border px-4 py-3">
              <p className="font-medium">
                {appeal.stage === 'selection' ? 'Отборочный этап' : 'Первый этап'} ·{' '}
                {APPEAL_STATUS_TITLES[appeal.status] ?? appeal.status}
              </p>
              <p className="mt-1 text-muted">
                Подана {formatMoscowHuman(appeal.submitted_at)} · срок подачи был до{' '}
                {formatMoscowHuman(appeal.deadline_at)}
              </p>
              {appeal.scan_url ? (
                <p className="mt-1">
                  <a
                    href={appeal.scan_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    Приложенный документ
                  </a>
                </p>
              ) : null}
              {appeal.protocol_url ? (
                <p className="mt-1">
                  <a
                    href={appeal.protocol_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    Протокол апелляционной комиссии
                  </a>
                </p>
              ) : null}
              {appeal.grounds ? (
                <p className="mt-1 text-muted">
                  Предмет: {APPEAL_GROUNDS.find((item) => item.value === appeal.grounds)?.title ?? appeal.grounds}
                </p>
              ) : null}
              {appeal.decision_note ? <p className="mt-1">Решение: {appeal.decision_note}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {participationClosed ? (
        <p className="text-sm text-muted">Апелляция недоступна: участие команды прекращено.</p>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          {error ? (
            <Alert tone="danger" title="Апелляция не подана">
              {error}
            </Alert>
          ) : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}

          <SelectField
            id="appeal-stage"
            label="Этап конкурса"
            value={stage}
            onChange={(event) => setStage(event.target.value as 'selection' | 'stage1')}
            options={[
              { value: 'selection', title: 'Отборочный этап' },
              { value: 'stage1', title: 'Первый этап' },
            ]}
            hint="Решения второго (финального) этапа не обжалуются (п. 12.3 Положения)."
          />
          <SelectField
            id="appeal-grounds"
            label="Предмет апелляции"
            value={grounds}
            onChange={(event) => setGrounds(event.target.value)}
            options={APPEAL_GROUNDS.map((ground) => ({ value: ground.value, title: ground.title }))}
          />
          <TextAreaField
            id="appeal-text"
            label="Мотивированное обоснование"
            required
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={10000}
            error={error && text.trim() === '' ? 'Изложите обоснование.' : undefined}
            hint="Укажите конкретные положения Положения, которые, по мнению команды, нарушены, и приложите ссылки на материалы."
          />
          <div className="flex flex-col gap-2">
            <label htmlFor="appeal-scan" className="mono-label">
              Приложить документ (необязательно)
            </label>
            <input
              id="appeal-scan"
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(event) => setScan(event.target.files?.[0] ?? null)}
              className="border border-border-strong bg-raised px-3 py-2 text-sm"
            />
            <p className="text-sm text-muted">
              Скан или документ, подтверждающий доводы. Файл видит только Оргкомитет и апелляционная комиссия.
              {scan ? ` Выбрано: ${scan.name}` : ''}
            </p>
          </div>
          <div>
            <Button type="submit" loading={busy} disabled={text.trim() === ''}>
              Подать апелляцию
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Материалы: строка статуса ────────────────────────────────────────────────

/** Требование к формату и объёму: форматы, шаблон имени и пояснение. */
export function RequirementNotes({ requirement }: { requirement: MaterialRequirement | null }) {
  if (!requirement) return null;
  const formats = requirement.allowed_extensions.length > 0 ? requirement.allowed_extensions.join(', ') : null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-muted">
      {formats ? <li>Форматы файла: {formats}.</li> : null}
      {requirement.name_template ? <li>Имя файла: {requirement.name_template}.</li> : null}
      <li>Срок: {formatMoscowHuman(requirement.due_at)}.</li>
      {requirement.description ? <li>{requirement.description}</li> : null}
    </ul>
  );
}

/** Строка «файл или ссылка» с размером и версией. */
export function MaterialFileLine({ material }: { material: Material }) {
  const name = material.file_name ?? material.external_url ?? '—';
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span className="break-all">{name}</span>
      {material.file_size !== null ? <span className="text-muted">{formatFileSize(material.file_size)}</span> : null}
      <span className="text-muted">версия {material.version}</span>
    </span>
  );
}
