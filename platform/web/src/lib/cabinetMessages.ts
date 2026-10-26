import { useSyncExternalStore } from 'react';
import { ApiError, api, type CabinetMessagesResponse, type TeamMessage } from '@shared/index';

// Лента переписки команды с Оргкомитетом, общая для личного кабинета:
// страницы «Сообщения», счётчика в навигации и фоновых уведомлений.
//
// Зачем отдельный модуль:
//   • навигация и страница должны видеть одно и то же число непрочитанных;
//   • опрос раз в 60 секунд идёт с любого экрана кабинета, а не только со
//     страницы сообщений;
//   • последний известный id хранится в localStorage, чтобы браузер не показывал
//     одно и то же сообщение при каждой перезагрузке.
//
// Опрос идёт с `peek=1`: сервер отдаёт ленту и счётчик, но не отмечает
// сообщения прочитанными. Прочитанным лента помечается только когда команда
// действительно открыла страницу «Сообщения» (обычный запрос без peek).

const STORAGE_PREFIX = 'lp_cabinet_admin_seen:';
/** Сообщений в ленте: сервер отдаёт последние 100, клиент хранит столько же. */
const MAX_ITEMS = 100;

export interface CabinetMessagesSnapshot {
  items: TeamMessage[];
  /** Непрочитанные сообщения Оргкомитета на момент последнего опроса. */
  unread: number;
  loading: boolean;
  error: string | null;
  ready: boolean;
}

const emptySnapshot: CabinetMessagesSnapshot = {
  items: [],
  unread: 0,
  loading: false,
  error: null,
  ready: false,
};

let snapshot: CabinetMessagesSnapshot = emptySnapshot;
let activeTeamKey: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function update(partial: Partial<CabinetMessagesSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  emit();
}

export function subscribeCabinetMessages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCabinetMessagesSnapshot(): CabinetMessagesSnapshot {
  return snapshot;
}

/** Состояние ленты в React: список, счётчик непрочитанного, ошибка загрузки. */
export function useCabinetMessages(): CabinetMessagesSnapshot {
  return useSyncExternalStore(subscribeCabinetMessages, getCabinetMessagesSnapshot, getCabinetMessagesSnapshot);
}

/** Сбрасывает ленту при смене команды: чужой счётчик не должен переезжать. */
export function setCabinetMessagesTeam(teamKey: string): void {
  if (activeTeamKey === teamKey) return;
  activeTeamKey = teamKey;
  snapshot = emptySnapshot;
  emit();
}

function seenKey(teamKey: string): string {
  return `${STORAGE_PREFIX}${teamKey}`;
}

function readSeenId(teamKey: string): number | null {
  try {
    const raw = window.localStorage.getItem(seenKey(teamKey));
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSeenId(teamKey: string, id: number): void {
  try {
    window.localStorage.setItem(seenKey(teamKey), String(id));
  } catch {
    // Приватный режим браузера: уведомление покажется повторно, данные не пострадают.
  }
}

function highestAdminId(items: TeamMessage[]): number {
  let highest = 0;
  for (const item of items) {
    if (item.author_role === 'admin' && item.id > highest) highest = item.id;
  }
  return highest;
}

/** Запоминает, что команда видела ленту: уведомления по этим сообщениям не нужны. */
function markSeen(items: TeamMessage[], teamKey: string): void {
  const highest = highestAdminId(items);
  if (highest > 0) writeSeenId(teamKey, highest);
}

/** Показывает одно браузерное уведомление; молча выходит без разрешения. */
function showNotification(message: TeamMessage): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (window.Notification.permission !== 'granted') return;

  const text = message.body.length > 140 ? `${message.body.slice(0, 137)}…` : message.body;
  try {
    new window.Notification('Личный кабинет: новое сообщение', {
      body: text,
      tag: 'lp-cabinet-message',
    });
  } catch {
    // Некоторые браузеры запрещают конструктор Notification в фоне — молча
    // пропускаем: счётчик в навигации остаётся источником истины.
  }
}

/**
 * Показывает браузерное уведомление о новых сообщениях Оргкомитета.
 * Разрешение запрашивается только по кнопке (см. CabinetNotifications).
 */
function notifyAboutNewMessages(items: TeamMessage[], teamKey: string): void {
  const adminItems = items.filter((item) => item.author_role === 'admin');
  if (adminItems.length === 0) return;

  const highest = highestAdminId(items);
  const seen = readSeenId(teamKey);
  if (seen === null) {
    // Первый запуск: ориентируемся на серверную отметку прочтения. Об уже
    // прочитанной истории не сообщаем, а о непрочитанном — сообщаем один раз;
    // иначе команда получила бы пачку уведомлений за весь прошлый диалог.
    const unread = adminItems.filter((item) => item.read_by_team_at === null);
    const lastUnread = unread[unread.length - 1];
    if (lastUnread) showNotification(lastUnread);
    if (highest > 0) writeSeenId(teamKey, highest);
    return;
  }

  const fresh = adminItems.filter((item) => item.id > seen);
  if (highest > seen) writeSeenId(teamKey, highest);
  const last = fresh[fresh.length - 1];
  if (last) showNotification(last);
}

/**
 * Загружает ленту.
 *
 * @param teamKey  ключ команды для localStorage (номер заявки или id);
 * @param peek     не отмечать сообщения прочитанными (фоновый опрос);
 * @param notify   показать браузерное уведомление о новых сообщениях админа.
 */
export async function refreshCabinetMessages(options: {
  teamKey: string;
  peek?: boolean;
  notify?: boolean;
}): Promise<CabinetMessagesResponse> {
  const { teamKey, peek = false, notify = false } = options;
  setCabinetMessagesTeam(teamKey);
  update({ loading: !snapshot.ready, error: null });

  try {
    const response = await api.cabinetMessages({ peek });
    update({
      items: response.items.slice(-MAX_ITEMS),
      unread: peek ? response.unread_for_team : 0,
      loading: false,
      error: null,
      ready: true,
    });
    if (peek) {
      if (notify) notifyAboutNewMessages(response.items, teamKey);
    } else {
      markSeen(response.items, teamKey);
    }
    return response;
  } catch (caught) {
    update({
      loading: false,
      error: caught instanceof ApiError ? caught.message : 'Не удалось загрузить переписку с Оргкомитетом.',
    });
    throw caught;
  }
}
