import { useEffect, useState } from 'react';
import { Button } from '@shared/index';
import {
  refreshCabinetMessages,
  setCabinetMessagesTeam,
  useCabinetMessages,
} from '@/lib/cabinetMessages';

// Браузерные уведомления личного кабинета (ТЗ 06, п. 2.4).
//
// Устроено без внешней инфраструктуры: страница сама опрашивает
// /api/cabinet/messages раз в 60 секунд и при возврате на вкладку, а о новых
// сообщениях Оргкомитета сообщает локальным Notification. Push-сервер не нужен,
// поэтому уведомления работают сразу после выкладки.
//
// Разрешение запрашивается ТОЛЬКО по нажатию кнопки: браузеры блокируют
// автоматический запрос, а неожиданное окно раздражает команду.

const POLL_INTERVAL_MS = 60_000;

type PermissionState = NotificationPermission | 'unsupported';

function currentPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export function CabinetNotifications({ teamKey }: { teamKey: string }) {
  const [permission, setPermission] = useState<PermissionState>(() => currentPermission());
  const [requesting, setRequesting] = useState(false);
  const { unread } = useCabinetMessages();

  // Опрос: сразу при открытии, далее раз в минуту и при возврате на вкладку.
  useEffect(() => {
    setCabinetMessagesTeam(teamKey);
    let disposed = false;

    const poll = () => {
      if (disposed) return;
      void refreshCabinetMessages({ teamKey, peek: true, notify: true }).catch(() => {
        // Ошибка сети или истёкшая сессия: страница сама покажет состояние,
        // уведомления просто не придут до следующего успешного опроса.
      });
    };

    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [teamKey]);

  async function enableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    setRequesting(true);
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        // Сразу сообщаем об уже непрочитанном: команда включила уведомления
        // именно для того, чтобы не пропустить ответ Оргкомитета.
        void refreshCabinetMessages({ teamKey, peek: true, notify: true }).catch(() => undefined);
      }
    } finally {
      setRequesting(false);
    }
  }

  if (permission === 'unsupported') {
    return (
      <div className="border border-border bg-surface px-4 py-3">
        <p className="mono-label text-muted">Уведомления</p>
        <p className="mt-2 text-sm text-muted">
          Браузер не поддерживает уведомления. Новые сообщения видны в разделе «Сообщения».
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="mono-label text-muted">Уведомления</p>
        {unread > 0 ? (
          <span
            className="rounded-pill bg-accent-solid px-2 text-mono-sm text-on-accent"
            title="Непрочитанных сообщений Оргкомитета"
          >
            {unread}
          </span>
        ) : null}
      </div>

      {permission === 'granted' ? (
        <p className="mt-2 text-sm text-muted" role="status">
          Включены: о новом сообщении Оргкомитета сообщит браузер.
        </p>
      ) : permission === 'denied' ? (
        <p className="mt-2 text-sm text-muted" role="status">
          Уведомления заблокированы в настройках браузера для этого сайта. Новые сообщения видны в разделе
          «Сообщения».
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            О новом ответе Оргкомитета сообщит браузер — только после вашего разрешения.
          </p>
          <div className="mt-3">
            <Button variant="secondary" loading={requesting} onClick={() => void enableNotifications()}>
              Включить уведомления
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
