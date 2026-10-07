import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminApiError, type AdminLead, adminApi, formatMoscowHuman, formatPhone, pluralize } from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField, TextAreaField, TextField } from '@shared/index';

// Обращения Оргкомитету (ТЗ 07, п. 2.15, ТЗ 06 п. 4.4).
//
// Обращение приходит с формы на сайте либо из личного кабинета команды — во
// втором случае сервер передаёт team_id, и панель показывает, от какой команды
// оно пришло: так обращение «дедлайн пропущен» не теряет контекст.
//
// Отправка письма из панели в API не предусмотрена: ответ фиксируется
// комментарием Оргкомитета и статусом, о чём интерфейс прямо предупреждает —
// вместо кнопки, которая ничего не делает.

const LEAD_STATUS_TITLES: Record<string, string> = {
  new: 'Новое',
  in_progress: 'В работе',
  answered: 'Отвечено',
  closed: 'Закрыто',
  spam: 'Спам',
};

const LEAD_STATUS_ORDER = ['new', 'in_progress', 'answered', 'closed', 'spam'];

function sourceTitle(source: string): string {
  if (source === 'site') return 'Форма на сайте';
  if (source === 'cabinet') return 'Личный кабинет команды';
  return source;
}

/** Ошибка объясняет, что делать (ТЗ 07, п. 3.5). */
function explain(caught: unknown, fallback: string): string {
  if (caught instanceof AdminApiError) {
    if (caught.status === 0) return `${caught.message} Проверьте соединение и повторите запрос.`;
    if (caught.status === 401 || caught.status === 403) {
      return `${caught.message} Возможно, сеанс завершён — войдите в панель заново.`;
    }
    return caught.message;
  }
  return fallback;
}

export function LeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const query = searchParams.get('q') ?? '';

  const [searchDraft, setSearchDraft] = useState(query);
  const [rows, setRows] = useState<AdminLead[]>([]);
  const [teamNames, setTeamNames] = useState<Map<number, string>>(new Map());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusDraft, setStatusDraft] = useState('new');
  const [commentDraft, setCommentDraft] = useState('');
  // Ответ на обращение (ТЗ 07, п. 2.15): текст фиксируется в карточке, письмо
  // включится вместе с почтовым транспортом.
  const [responseDraft, setResponseDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Название команды: в строке обращения есть только team_id, поэтому
      // справочник команд подтягивается отдельно (ТЗ 06, п. 4.4).
      const [leads, teams] = await Promise.all([
        adminApi.leads({ status: status === '' ? undefined : status, q: query === '' ? undefined : query }),
        adminApi.teams().catch(() => []),
      ]);
      setRows(leads);
      setTeamNames(new Map(teams.map((team) => [team.id, team.name])));
    } catch (caught) {
      setError(explain(caught, 'Не удалось получить список обращений.'));
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = rows.find((lead) => lead.id === selectedId) ?? null;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function openLead(lead: AdminLead) {
    setSelectedId(lead.id);
    setStatusDraft(lead.status);
    setCommentDraft(lead.admin_comment ?? '');
    setResponseDraft(lead.response_text ?? '');
    setNotice(null);
    setError(null);
  }

  async function save(lead: AdminLead) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.updateLead(lead.id, {
        status: statusDraft,
        admin_comment: commentDraft.trim() === '' ? null : commentDraft.trim(),
      });
      setNotice(
        `Обращение № ${lead.id} обновлено: статус — «${LEAD_STATUS_TITLES[statusDraft] ?? statusDraft}».`
      );
      await load();
      // При активном фильтре по статусу обращение может выпасть из выборки:
      // тогда карточка закрывается, чтобы не показывать устаревшие данные.
      if (status !== '' && status !== statusDraft) setSelectedId(null);
    } catch (caught) {
      setError(explain(caught, 'Не удалось сохранить обращение.'));
    } finally {
      setBusy(false);
    }
  }

  /** Ответ на обращение: текст ответа сохраняется в карточке (ТЗ 07, п. 2.15). */
  async function respond(lead: AdminLead) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.respondLead(lead.id, responseDraft.trim());
      setStatusDraft(result.status);
      setNotice(
        result.delivery_note ??
          `Ответ по обращению № ${lead.id} сохранён. Отправка письмом включится вместе с почтовым транспортом.`
      );
      await load();
      if (status !== '' && status !== 'answered') setSelectedId(null);
    } catch (caught) {
      setError(explain(caught, 'Не удалось сохранить ответ.'));
    } finally {
      setBusy(false);
    }
  }

  async function closeLead(lead: AdminLead) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Отдельное действие «Закрыть» — один запрос, как и обычное сохранение.
      await adminApi.updateLead(lead.id, {
        status: 'closed',
        admin_comment: commentDraft.trim() === '' ? null : commentDraft.trim(),
      });
      setStatusDraft('closed');
      setNotice(`Обращение № ${lead.id} закрыто.`);
      await load();
      if (status !== '' && status !== 'closed') setSelectedId(null);
    } catch (caught) {
      setError(explain(caught, 'Не удалось закрыть обращение.'));
    } finally {
      setBusy(false);
    }
  }

  const counts = LEAD_STATUS_ORDER.map((value) => ({
    value,
    count: rows.filter((lead) => lead.status === value).length,
  }));

  const teamName = (teamId: number): string => teamNames.get(teamId) ?? `Команда № ${teamId}`;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Обращения Оргкомитету"
        title="Обращения"
        lead="Входящие с формы на сайте и из личного кабинета команды: обращения из кабинета приходят с контекстом команды. Статус показывает, на каком шаге ответ."
        aside={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            Обновить
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" title="Не удалось выполнить">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Готово">
          {notice}
        </Alert>
      ) : null}

      <Alert tone="info" title="Ответ отправляется с почты Оргкомитета">
        Отправка письма участнику из панели в API не предусмотрена. Зафиксируйте ответ в комментарии Оргкомитета и
        смените статус на «Отвечено», а письмо отправьте с адреса Оргкомитета.
      </Alert>

      <SectionCard
        title="Фильтры"
        description={`Обращений в выборке: ${rows.length}. Быстрый переход по статусам: ${counts
          .map((item) => `${LEAD_STATUS_TITLES[item.value] ?? item.value} — ${item.count}`)
          .join('; ')}.`}
      >
        <form
          className="grid gap-4 md:grid-cols-[2fr,1fr,auto]"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setParam('q', searchDraft.trim());
          }}
        >
          <TextField
            id="leads-search"
            label="Поиск по имени или почте"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Например, Иванова или captain@example.ru"
          />
          <SelectField
            id="leads-status"
            label="Статус обращения"
            value={status}
            options={LEAD_STATUS_ORDER.map((value) => ({
              value,
              title: LEAD_STATUS_TITLES[value] ?? value,
            }))}
            placeholder="Все статусы"
            onChange={(event) => setParam('status', event.target.value)}
          />
          <div className="flex items-end">
            <Button type="submit" loading={loading}>
              Найти
            </Button>
          </div>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={status === '' ? 'primary' : 'secondary'}
            aria-current={status === '' ? 'true' : undefined}
            onClick={() => setParam('status', '')}
          >
            Все обращения
          </Button>
          {counts
            .filter((item) => item.count > 0)
            .map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={status === item.value ? 'primary' : 'secondary'}
                aria-current={status === item.value ? 'true' : undefined}
                onClick={() => setParam('status', item.value)}
              >
                {LEAD_STATUS_TITLES[item.value] ?? item.value} · {item.count}
              </Button>
            ))}
        </div>
      </SectionCard>

      {selected ? (
        <SectionCard
          title={`Обращение № ${selected.id}`}
          description={`Поступило ${formatMoscowHuman(selected.created_at)}; источник — ${sourceTitle(selected.source)}.`}
          actions={
            <Button type="button" variant="quiet" onClick={() => setSelectedId(null)}>
              Закрыть карточку
            </Button>
          }
        >
          <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
            <div>
              <dt className="mono-label text-muted">Имя</dt>
              <dd>{selected.name}</dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Почта для ответа</dt>
              <dd>
                <a href={`mailto:${selected.email}`} className="text-accent underline underline-offset-2">
                  {selected.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Телефон</dt>
              <dd>{selected.phone ? formatPhone(selected.phone) : '—'}</dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Тема</dt>
              <dd>{selected.topic ?? '—'}</dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Команда</dt>
              <dd>
                {selected.team_id === null ? (
                  'обращение с формы на сайте, команда не указана'
                ) : (
                  <>
                    <Link
                      to={`/teams?q=${encodeURIComponent(teamName(selected.team_id))}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {teamName(selected.team_id)}
                    </Link>
                    <span className="block text-muted">
                      обращение из личного кабинета команды · № {selected.team_id}
                    </span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="mono-label text-muted">Обновлено</dt>
              <dd>{formatMoscowHuman(selected.updated_at)}</dd>
            </div>
          </dl>

          <div className="mt-5">
            <p className="mono-label text-muted">Текст обращения</p>
            <p className="mt-2 max-w-measure whitespace-pre-line break-words">{selected.message}</p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[1fr,2fr]">
            <SelectField
              id="lead-status-draft"
              label="Статус обращения"
              value={statusDraft}
              options={LEAD_STATUS_ORDER.map((value) => ({
                value,
                title: LEAD_STATUS_TITLES[value] ?? value,
              }))}
              hint="Обычный порядок: Новое → В работе → Отвечено → Закрыто. «Спам» — для рассылок и автоматических отправлений."
            />
            <TextAreaField
              id="lead-comment"
              label="Комментарий Оргкомитета"
              value={commentDraft}
              maxLength={3000}
              onChange={(event) => setCommentDraft(event.target.value)}
              hint="Служебная запись для внутреннего разбора: участнику не показывается."
            />
            {/* Ответ на обращение (ТЗ 07, п. 2.15): текст сохраняется в карточке
                и будет отправлен, когда подключится почтовый транспорт. */}
            <TextAreaField
              id="lead-response"
              label="Ответ участнику"
              value={responseDraft}
              maxLength={5000}
              onChange={(event) => setResponseDraft(event.target.value)}
              hint="Текст ответа сохраняется в карточке обращения. Отправка письмом включится вместе с почтовым транспортом."
            />
          </div>

          {selected.response_text ? (
            <p className="mt-3 text-sm text-muted">
              Ответ записан {selected.responded_at ? formatMoscowHuman(selected.responded_at) : ''}
              {selected.responded_by ? ` (пользователь № ${selected.responded_by})` : ''}.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              loading={busy}
              disabled={statusDraft === selected.status && commentDraft.trim() === (selected.admin_comment ?? '')}
              title={
                statusDraft === selected.status && commentDraft.trim() === (selected.admin_comment ?? '')
                  ? 'Изменений нет: смените статус или дополните комментарий'
                  : undefined
              }
              onClick={() => void save(selected)}
            >
              Сохранить обращение
            </Button>
            <Button
              type="button"
              loading={busy}
              disabled={responseDraft.trim().length < 3}
              title={responseDraft.trim().length < 3 ? 'Введите текст ответа участнику' : undefined}
              onClick={() => void respond(selected)}
            >
              Сохранить ответ участнику
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={busy}
              disabled={selected.status === 'closed'}
              title={selected.status === 'closed' ? 'Обращение уже закрыто' : 'Закрыть обращение с текущим комментарием'}
              onClick={() => void closeLead(selected)}
            >
              Закрыть обращение
            </Button>
          </div>
          {statusDraft === selected.status && commentDraft.trim() === (selected.admin_comment ?? '') ? (
            <p className="mt-2 text-sm text-muted">
              Изменений нет. Сохранение станет доступно, когда вы смените статус или дополните комментарий.
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Очередь обращений"
        description="Новые сверху. Карточка открывается кнопкой «Открыть»."
      >
        {loading && rows.length === 0 ? <p role="status">Загружаем обращения…</p> : null}

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-muted">
            {status === '' && query === ''
              ? 'Обращений пока нет. Они появятся здесь после первого сообщения через форму на сайте или из личного кабинета команды.'
              : 'По этим условиям обращений нет. Измените фильтр или сбросьте его.'}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <caption className="sr-only-text">Обращения Оргкомитету</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4">
                      Дата
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Имя
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Почта
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Телефон
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Тема
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Источник
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Команда
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Статус
                    </th>
                    <th scope="col" className="py-2">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr key={lead.id} className="border-b border-border align-top">
                      <td className="py-3 pr-4">{formatMoscowHuman(lead.created_at)}</td>
                      <td className="py-3 pr-4">{lead.name}</td>
                      <td className="py-3 pr-4 break-all">{lead.email}</td>
                      <td className="py-3 pr-4">{lead.phone ? formatPhone(lead.phone) : '—'}</td>
                      <td className="py-3 pr-4 max-w-measure break-words">{lead.topic ?? '—'}</td>
                      <td className="py-3 pr-4">{sourceTitle(lead.source)}</td>
                      <td className="py-3 pr-4">{lead.team_id === null ? '—' : teamName(lead.team_id)}</td>
                      <td className="py-3 pr-4">{LEAD_STATUS_TITLES[lead.status] ?? lead.status}</td>
                      <td className="py-3">
                        <Button
                          type="button"
                          variant="secondary"
                          aria-expanded={selectedId === lead.id}
                          onClick={() => openLead(lead)}
                        >
                          Открыть
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* На узких экранах таблица превращается в карточки (ТЗ 08, п. 3.6). */}
            <ul className="flex flex-col gap-4 md:hidden">
              {rows.map((lead) => (
                <li key={`card-${lead.id}`} className="border border-border p-4 text-sm">
                  <p className="mono-label text-muted">{formatMoscowHuman(lead.created_at)}</p>
                  <p className="mt-1 font-semibold">{lead.name}</p>
                  <p className="mt-1 break-all">{lead.email}</p>
                  <dl className="mt-3 flex flex-col gap-2">
                    <div>
                      <dt className="text-muted">Телефон</dt>
                      <dd>{lead.phone ? formatPhone(lead.phone) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Тема</dt>
                      <dd>{lead.topic ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Источник</dt>
                      <dd>{sourceTitle(lead.source)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Команда</dt>
                      <dd>{lead.team_id === null ? 'не указана' : teamName(lead.team_id)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Статус</dt>
                      <dd>{LEAD_STATUS_TITLES[lead.status] ?? lead.status}</dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="secondary"
                      aria-expanded={selectedId === lead.id}
                      onClick={() => openLead(lead)}
                    >
                      Открыть
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </SectionCard>

      <p className="text-sm text-muted">
        Всего обращений в выборке: {pluralize(rows.length, ['обращение', 'обращения', 'обращений'])}.
      </p>
    </main>
  );
}
