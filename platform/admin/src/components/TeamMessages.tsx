import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AdminApiError,
  adminApi,
  formatMoscowHuman,
  type AdminTeamMessagesResponse,
  type TeamMessage,
} from '@shared/index';
import { Alert, Button, TextAreaField } from '@shared/index';

// Переписка с командой в карточке команды (ТЗ 07, п. 2.15).
//
// Оргкомитет отвечает команде здесь; ответ появляется в разделе «Сообщения»
// личного кабинета и в браузерном уведомлении, если команда его включила.
// Открытие блока отмечает сообщения команды прочитанными — счётчик в заголовке
// показывает, сколько их было непрочитано к этому моменту.

const MAX_BODY_LENGTH = 5000;

export function TeamMessages({ teamId, teamName }: { teamId: number; teamName: string }) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const response: AdminTeamMessagesResponse = await adminApi.teamMessages(teamId);
      setMessages(response.items);
      setUnread(response.unread_for_admin);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : 'Не удалось загрузить переписку с командой.'
      );
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    setError(null);
    setNotice(null);
    if (text.length === 0) {
      setError('Введите текст сообщения.');
      return;
    }
    if (text.length > MAX_BODY_LENGTH) {
      setError(`Сообщение длиннее ${MAX_BODY_LENGTH} символов. Сократите текст.`);
      return;
    }

    setSending(true);
    try {
      await adminApi.sendTeamMessage(teamId, text);
      setDraft('');
      const response = await adminApi.teamMessages(teamId);
      setMessages(response.items);
      setUnread(response.unread_for_admin);
      setNotice('Сообщение отправлено команде.');
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : 'Не удалось отправить сообщение. Попробуйте ещё раз.'
      );
    } finally {
      setSending(false);
    }
  }

  const headingId = `team-messages-${teamId}`;

  return (
    <section className="border border-border" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <p id={headingId} className="mono-label text-muted">
            Переписка с командой
          </p>
          {unread > 0 ? (
            <span className="rounded-pill border border-accent px-2 text-mono-sm text-accent" role="status">
              Непрочитанных от команды: {unread}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="quiet" loading={loading} onClick={() => void load()}>
          Обновить
        </Button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <p className="text-sm text-muted">
          Сообщения видны команде «{teamName}» в разделе «Сообщения» личного кабинета. Переписка относится только к
          этой команде и не попадает в публичную часть сайта.
        </p>

        {loading && messages.length === 0 ? <p role="status">Загружаем переписку…</p> : null}

        {!loading && messages.length === 0 ? (
          <p className="border border-border bg-surface px-4 py-4 text-sm text-muted">
            Переписка ещё не начиналась. Напишите команде — сообщение появится в её личном кабинете.
          </p>
        ) : null}

        {messages.length > 0 ? (
          <ul className="flex flex-col gap-3" aria-label={`Переписка с командой ${teamName}`}>
            {messages.map((message) => {
              const isAdmin = message.author_role === 'admin';
              const isSystem = message.author_role === 'system';
              return (
                <li key={message.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] border px-4 py-3 ${
                      isAdmin ? 'border-accent bg-raised' : 'border-border bg-surface'
                    }`}
                  >
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="mono-label text-muted">
                        {isAdmin ? 'Оргкомитет' : isSystem ? 'Система' : 'Команда'}
                      </span>
                      <span className="text-sm text-muted">{formatMoscowHuman(message.created_at)}</span>
                      {message.author_name ? (
                        <span className="text-sm text-muted">· {message.author_name}</span>
                      ) : null}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <form className="flex flex-col gap-3 border-t border-border pt-4" onSubmit={(event) => void submit(event)}>
          <TextAreaField
            id={`team-message-body-${teamId}`}
            label="Сообщение команде"
            value={draft}
            maxLength={MAX_BODY_LENGTH}
            rows={4}
            hint={`От 1 до ${MAX_BODY_LENGTH} символов. Команда увидит сообщение в личном кабинете.`}
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
      </div>
    </section>
  );
}
