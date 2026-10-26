import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  api,
  formatMoscowHuman,
  type CabinetMessagesResponse,
  type TeamMessage,
} from '@shared/index';
import { Alert, Button, TextAreaField } from '@shared/index';
import { useSeo } from '@/lib/seo';
import { refreshCabinetMessages } from '@/lib/cabinetMessages';
import {
  type CabinetData,
  CabinetLayout,
  CabinetLoadError,
  CabinetLoading,
  CabinetSection,
  CabinetSessionLost,
  fetchCabinetData,
} from './CabinetActions';

// Раздел личного кабинета «Сообщения» (ТЗ 06, п. 2.4).
//
// Переписка с Оргкомитетом: сообщения администратора слева, ответы команды
// справа. Здесь же открывается вся лента, которую команда видит в навигации
// со счётчиком непрочитанного. Уведомления о новых сообщениях включает
// отдельный блок кабинета (CabinetNotifications).

const MAX_BODY_LENGTH = 5000;
const POLL_INTERVAL_MS = 60_000;

function teamKeyOf(team: CabinetData['team']): string {
  return team.public_number ?? String(team.id);
}

export function CabinetMessagesPage() {
  useSeo({
    title: 'Сообщения Оргкомитета',
    description:
      'Переписка команды с Оргкомитетом конкурса «Лидеры права – 2027» в личном кабинете: ответы на вопросы и уведомления о новых сообщениях.',
    path: '/cabinet/messages',
  });

  const [data, setData] = useState<CabinetData | null>(null);
  const [items, setItems] = useState<TeamMessage[]>([]);
  const [unreadAtOpen, setUnreadAtOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setSessionLost(false);
    try {
      const cabinetData = await fetchCabinetData();
      const response = await refreshCabinetMessages({ teamKey: teamKeyOf(cabinetData.team) });
      setItems(response.items);
      setUnreadAtOpen(response.unread_for_team);
      setData(cabinetData);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSessionLost(true);
        setData(null);
      } else {
        setError(
          caught instanceof ApiError ? caught.message : 'Не удалось загрузить переписку с Оргкомитетом.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoading label="Открываем переписку с Оргкомитетом…" />
      </main>
    );
  }

  if (sessionLost) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetSessionLost />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoadError
          message={error ?? 'Не удалось получить данные команды.'}
          onRetry={() => void load()}
        />
      </main>
    );
  }

  return (
    <CabinetLayout
      data={data}
      title="Сообщения"
      lead="Переписка с Оргкомитетом: здесь появляются ответы на вопросы команды. Новые сообщения отмечаются в навигации и, если включены уведомления, в браузере."
      onReload={load}
    >
      <MessagesSection data={data} initialItems={items} initialUnread={unreadAtOpen} />
    </CabinetLayout>
  );
}

function MessagesSection({
  data,
  initialItems,
  initialUnread,
}: {
  data: CabinetData;
  initialItems: TeamMessage[];
  initialUnread: number;
}) {
  const teamKey = teamKeyOf(data.team);
  const [items, setItems] = useState<TeamMessage[]>(initialItems);
  const [unreadAtOpen, setUnreadAtOpen] = useState(initialUnread);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Каркас кабинета умеет перезагружать данные (например, после отказа от
  // участия): синхронизируем ленту с результатом родительской загрузки.
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);
  useEffect(() => {
    setUnreadAtOpen(initialUnread);
  }, [initialUnread]);

  const refresh = useCallback(
    async (markRead: boolean) => {
      const response: CabinetMessagesResponse = await refreshCabinetMessages({
        teamKey,
        peek: !markRead,
      });
      if (markRead) {
        setItems(response.items);
        setUnreadAtOpen(0);
      } else if (response.unread_for_team > unreadAtOpen) {
        setUnreadAtOpen(response.unread_for_team);
      }
      return response;
    },
    [teamKey, unreadAtOpen]
  );

  // Пока страница открыта, лента обновляется сама: команда видит ответ, не
  // перезагружая вкладку. Открытая лента считается прочитанной.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refresh(true).catch(() => undefined);
    }, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(true).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    setFormError(null);
    setNotice(null);
    if (text.length === 0) {
      setFormError('Введите текст сообщения.');
      return;
    }
    if (text.length > MAX_BODY_LENGTH) {
      setFormError(`Сообщение длиннее ${MAX_BODY_LENGTH} символов. Сократите текст.`);
      return;
    }

    setSending(true);
    try {
      await api.cabinetSendMessage(text);
      setDraft('');
      const response = await refreshCabinetMessages({ teamKey });
      setItems(response.items);
      setUnreadAtOpen(0);
      setNotice('Сообщение отправлено Оргкомитету.');
    } catch (caught) {
      setFormError(
        caught instanceof ApiError ? caught.message : 'Не удалось отправить сообщение. Попробуйте ещё раз.'
      );
    } finally {
      setSending(false);
    }
  }

  async function manualRefresh() {
    setRefreshing(true);
    setFormError(null);
    try {
      await refresh(true);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Не удалось обновить переписку.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <CabinetSection
      title="Переписка с Оргкомитетом"
      description="Один вопрос — одно сообщение: так ответ приходит быстрее. В сообщении видны автор и время по московскому времени."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            Заявка <span className="font-mono">{data.team.public_number ?? '—'}</span> · {data.team.name}
          </span>
          {unreadAtOpen > 0 ? (
            <span className="rounded-pill border border-accent px-2 text-mono-sm text-accent" role="status">
              Непрочитанных: {unreadAtOpen}
            </span>
          ) : null}
        </div>
        <Button variant="quiet" loading={refreshing} onClick={() => void manualRefresh()}>
          Обновить переписку
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 border border-border bg-surface px-4 py-6 text-sm text-muted">
          Пока сообщений нет — Оргкомитет ответит здесь.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3" aria-label="Переписка с Оргкомитетом">
          {items.map((message) => {
            const isTeam = message.author_role === 'team';
            const isSystem = message.author_role === 'system';
            const isNew = !isTeam && !isSystem && message.read_by_team_at === null;
            return (
              <li key={message.id} className={`flex ${isTeam ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] border px-4 py-3 ${
                    isTeam ? 'border-accent bg-raised' : 'border-border bg-surface'
                  }`}
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="mono-label text-muted">
                      {isTeam ? 'Команда' : isSystem ? 'Система' : 'Оргкомитет'}
                    </span>
                    <span className="text-sm text-muted">{formatMoscowHuman(message.created_at)}</span>
                    {message.author_name ? (
                      <span className="text-sm text-muted">· {message.author_name}</span>
                    ) : null}
                    {isNew ? (
                      <span className="rounded-pill border border-accent px-2 text-mono-sm text-accent">новое</span>
                    ) : null}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {notice ? (
        <div className="mt-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-3 border-t border-border pt-6" onSubmit={(event) => void submit(event)}>
        <TextAreaField
          id="cabinet-message-body"
          label="Сообщение Оргкомитету"
          value={draft}
          maxLength={MAX_BODY_LENGTH}
          rows={4}
          error={formError ?? undefined}
          hint={`От 1 до ${MAX_BODY_LENGTH} символов. Не прикладывайте персональные данные, если они не нужны для вопроса.`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={sending} disabled={draft.trim().length === 0}>
            Отправить
          </Button>
          <span className="text-sm text-muted">
            {draft.length} / {MAX_BODY_LENGTH}
          </span>
        </div>
      </form>

      <p className="mt-4 text-sm text-muted">
        Ответ придёт в этот раздел. Включить уведомления в браузере можно в блоке «Уведомления» слева. Если вопрос
        срочный, воспользуйтесь{' '}
        <Link to="/cabinet/help" className="text-accent underline underline-offset-2">
          контактами Оргкомитета
        </Link>
        .
      </p>
    </CabinetSection>
  );
}
