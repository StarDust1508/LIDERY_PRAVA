import { useCallback, useEffect, useState } from 'react';
import {
  AdminApiError,
  adminApi,
  formatMoscowHuman,
  type AdminPdnRequest,
  type AdminPdnSubject,
} from '@shared/index';
import { Alert, Button, SectionCard, SelectField, TextAreaField, TextField } from '@shared/index';

// Права субъекта персональных данных (ТЗ 11, п. 6).
//
// Ответственный за обработку персональных данных выполняет здесь четыре
// законных требования человека: доступ к своим данным, исправление, удаление и
// отзыв согласия. Плюс ведётся учёт обращений со сроком ответа 10 рабочих дней
// (ст. 20 152-ФЗ): без учёта срок никто не контролирует.
//
// Раздел открыт только роли «администратор»: он меняет персональные данные.

const KIND_TITLES: Record<AdminPdnSubject['kind'], string> = {
  participant: 'Участник',
  mentor: 'Наставник',
  lead: 'Обращение',
  legacy: 'Заявка 2026 (архив)',
};

const REQUEST_KINDS = [
  { value: 'access', title: 'Доступ к своим данным' },
  { value: 'correction', title: 'Исправление данных' },
  { value: 'erasure', title: 'Удаление данных' },
  { value: 'withdrawal', title: 'Отзыв согласия' },
  { value: 'other', title: 'Иное обращение' },
];

const REQUEST_STATUSES = [
  { value: 'new', title: 'Новое' },
  { value: 'in_progress', title: 'В работе' },
  { value: 'done', title: 'Исполнено' },
  { value: 'refused', title: 'Отказано' },
];

// Отдельный фильтр «просроченные»: срок ответа 10 рабочих дней, и нарушение
// срока — юридически значимый факт, его нужно видеть списком.
const REQUEST_FILTERS = [...REQUEST_STATUSES, { value: 'overdue', title: 'Просроченные' }];

export function SubjectsPage() {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<AdminPdnSubject[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<{
    subject: AdminPdnSubject;
    rows: Array<[string, string]>;
    // Право на доступ — это и согласия, и материалы: API их отдаёт, а панель
    // показывала только сведения о человеке.
    consents: Array<Record<string, unknown>>;
    /** Матрица согласия на распространение по категориям (Приложение № 12). */
    distribution: Array<Record<string, unknown>>;
    materials: Array<Record<string, unknown>>;
  } | null>(null);

  const [requests, setRequests] = useState<AdminPdnRequest[]>([]);
  const [newKind, setNewKind] = useState('access');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [requestFilter, setRequestFilter] = useState('');
  const [requestsLoading, setRequestsLoading] = useState(true);
  // Дата получения и канал: от даты получения считается срок ответа по
  // ст. 20 152-ФЗ, поэтому их нужно вводить, а не подразумевать.
  const [newReceivedAt, setNewReceivedAt] = useState('');
  const [newChannel, setNewChannel] = useState('email');
  // Решение по обращению: основание обязательно и вводится в форме, а не в
  // системном окне — отмена окна закрывала обращение без основания.
  const [decisionTarget, setDecisionTarget] = useState<{ request: AdminPdnRequest; status: string } | null>(null);
  const [decisionText, setDecisionText] = useState('');

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      setRequests(await adminApi.pdnRequests({ status: requestFilter }));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить обращения субъектов.');
    } finally {
      setRequestsLoading(false);
    }
  }, [requestFilter]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setDetails(null);
    if (query.trim().length < 3) {
      setError('Укажите не менее трёх символов: почту, фамилию или телефон субъекта.');
      return;
    }
    setBusy(true);
    try {
      const result = await adminApi.pdnSubjects(query.trim());
      setFound(result.subjects);
      setSearched(true);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Поиск не выполнен.');
    } finally {
      setBusy(false);
    }
  }

  async function openDetails(subject: AdminPdnSubject) {
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.pdnSubject(subject.kind, subject.id);
      const rows: Array<[string, string]> = Object.entries(data.person)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)]);
      setDetails({
        subject,
        rows,
        consents: (data.consents ?? []) as Array<Record<string, unknown>>,
        distribution: ((data as { distribution?: Array<Record<string, unknown>> }).distribution ??
          []) as Array<Record<string, unknown>>,
        materials: ((data as { materials?: Array<Record<string, unknown>> }).materials ?? []) as Array<
          Record<string, unknown>
        >,
      });
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Сведения недоступны.');
    } finally {
      setBusy(false);
    }
  }

  /** Выгрузка по праву доступа: файл CSV с полным набором сведений. */
  async function exportSubject(subject: AdminPdnSubject) {
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.pdnSubjectExport(subject.kind, subject.id);
      const rows: string[][] = [['Поле', 'Значение']];
      for (const [key, value] of Object.entries(data.person)) {
        rows.push([key, value === null || value === undefined ? '' : String(value)]);
      }
      rows.push(['', '']);
      rows.push(['Согласия', '']);
      for (const consent of data.consents) {
        rows.push([
          String(consent.document_code ?? ''),
          `версия ${String(consent.document_version ?? '')}, принято ${String(consent.accepted_at ?? '')}, отозвано ${String(consent.revoked_at ?? 'нет')}`,
        ]);
      }
      const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pdn-${subject.kind}-${subject.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Выгрузка сделана. Факт выгрузки записан в журнал действий.');
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Выгрузка не выполнена.');
    } finally {
      setBusy(false);
    }
  }

  async function eraseSubject(subject: AdminPdnSubject) {
    const reason = window.prompt(
      `Удаление персональных данных: ${subject.full_name ?? 'без имени'}\n` +
        'Опишите основание: обращение субъекта, решение Оргкомитета или срок хранения.\n\n' +
        'Действие необратимо: данные будут обезличены, согласия отозваны.'
    );
    if (!reason || reason.trim().length < 5) {
      setError('Удаление отменено: нужно указать основание.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.pdnSubjectErase(subject.kind, subject.id, reason.trim());
      setNotice(result.message);
      setDetails(null);
      setFound((current) =>
        current.map((item) => (item.kind === subject.kind && item.id === subject.id ? { ...item, erased: true } : item))
      );
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Удаление не выполнено.');
    } finally {
      setBusy(false);
    }
  }

  async function registerRequest(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await adminApi.createPdnRequest({
        kind: newKind,
        subject_name: newName.trim(),
        received_at: newReceivedAt === '' ? undefined : newReceivedAt,
        channel: newChannel,
        subject_email: newEmail.trim(),
        message: newMessage.trim() || null,
      });
      setNotice('Обращение зарегистрировано: срок ответа — 10 рабочих дней.');
      setNewName('');
      setNewEmail('');
      setNewMessage('');
      await loadRequests();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Обращение не зарегистрировано.');
    } finally {
      setBusy(false);
    }
  }

  /** Решение по обращению: статус и основание отправляются вместе. */
  async function confirmDecision() {
    if (!decisionTarget) return;
    const needsResolution = decisionTarget.status === 'done' || decisionTarget.status === 'refused';
    if (needsResolution && decisionText.trim().length < 3) {
      setError('Опишите, что сделано по обращению: без основания решение не сохраняется.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.updatePdnRequest(decisionTarget.request.id, {
        status: decisionTarget.status,
        resolution: needsResolution ? decisionText.trim() : null,
      });
      setNotice('Состояние обращения обновлено.');
      setDecisionTarget(null);
      setDecisionText('');
      await loadRequests();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось обновить обращение.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="mono-label text-muted">Персональные данные</p>
        <h1 className="mt-2 text-h2 font-semibold tracking-[var(--tr-heading)]">Права субъектов персональных данных</h1>
        <p className="mt-2 max-w-measure text-muted">
          Доступ, исправление, удаление и отзыв согласия выполняет ответственный за обработку персональных данных.
          Физического удаления строк нет: сведения обезличиваются, а запись о команде и результатах сохраняется —
          иначе рассыпалась бы история конкурса. Каждая операция попадает в журнал действий.
        </p>
      </header>

      {notice ? <Alert tone="success" title="Готово">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="Не удалось выполнить">{error}</Alert> : null}

      <SectionCard
        title="Поиск субъекта"
        description="По адресу электронной почты, фамилии или телефону — по участникам, наставникам, обращениям и архиву заявок 2026."
      >
        <form className="flex flex-col gap-4 md:flex-row md:items-end" onSubmit={search}>
          <div className="md:w-96">
            <TextField
              id="pdn-query"
              label="Почта, фамилия или телефон"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              hint="Не менее трёх символов."
            />
          </div>
          <Button type="submit" loading={busy}>
            Найти
          </Button>
        </form>

        {searched ? (
          found.length === 0 ? (
            <p className="mt-4 text-muted">
              Субъект не найден. Проверьте написание или поищите по другому признаку: возможно, данные уже обезличены.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col gap-4">
              {found.map((subject) => (
                <li key={`${subject.kind}-${subject.id}`} className="border border-border p-4">
                  <p className="font-medium">
                    {subject.full_name ?? 'без имени'}
                    {subject.erased ? <span className="ml-2 text-muted">данные обезличены</span> : null}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {KIND_TITLES[subject.kind]} · {subject.context ?? 'контекст не указан'} ·{' '}
                    {subject.created_at ? formatMoscowHuman(subject.created_at) : 'дата не указана'}
                  </p>
                  <p className="mt-1 text-sm">
                    {subject.email ?? 'почта удалена'} · {subject.phone ?? 'телефон удалён'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => void openDetails(subject)}>
                      Сведения
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void exportSubject(subject)}
                      title="Право на доступ: выгрузка всех сведений о субъекте"
                    >
                      Выгрузить CSV
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="border-danger text-danger"
                      disabled={subject.erased}
                      onClick={() => void eraseSubject(subject)}
                      title={subject.erased ? 'Данные уже обезличены' : 'Удаление персональных данных с обезличиванием'}
                    >
                      Удалить данные
                    </Button>
                  </div>

                  {details && details.subject.kind === subject.kind && details.subject.id === subject.id ? (
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="mono-label text-muted">Сведения о субъекте</p>
                      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                        {details.rows.map(([key, value]) => (
                          <div key={key} className="flex flex-wrap gap-2">
                            <dt className="font-mono text-muted">{key}</dt>
                            <dd className="break-all">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {details.consents.length > 0 ? (
                        <>
                          <p className="mono-label mt-4 text-muted">Согласия</p>
                          <ul className="mt-2 flex flex-col gap-2 text-sm">
                            {details.consents.map((consent, index) => (
                              <li key={`consent-${index}`} className="border-b border-border pb-2">
                                {String(consent.document_title ?? consent.document_code ?? 'согласие')}
                                {' · версия '}
                                {String(consent.document_version ?? '—')}
                                {' · принято '}
                                {consent.accepted_at ? formatMoscowHuman(String(consent.accepted_at)) : '—'}
                                {consent.revoked_at ? (
                                  <span className="text-danger">
                                    {' · отозвано '}
                                    {formatMoscowHuman(String(consent.revoked_at))}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {details.distribution.length > 0 ? (
                        <>
                          <p className="mono-label mt-4 text-muted">Согласие на распространение (Приложение № 12)</p>
                          <ul className="mt-2 flex flex-col gap-2 text-sm">
                            {details.distribution.map((row, index) => (
                              <li key={`distribution-${index}`} className="flex flex-wrap gap-3 border-b border-border pb-2">
                                <span className="font-mono text-muted">{String(row.category_code ?? '—')}</span>
                                <span>
                                  {row.allowed === true
                                    ? 'разрешено'
                                    : row.allowed === false
                                      ? 'не разрешено'
                                      : 'не отмечено'}
                                </span>
                                {row.decided_at ? (
                                  <span className="text-muted">{formatMoscowHuman(String(row.decided_at))}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {details.materials.length > 0 ? (
                        <>
                          <p className="mono-label mt-4 text-muted">Конкурсные материалы</p>
                          <ul className="mt-2 flex flex-col gap-2 text-sm">
                            {details.materials.map((material, index) => (
                              <li key={`material-${index}`}>
                                {String(material.type ?? 'материал')}
                                {material.status ? ` · ${String(material.status)}` : ''}
                                {material.created_at ? ` · ${formatMoscowHuman(String(material.created_at))}` : ''}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      <p className="mt-3 text-sm text-muted">
                        Исправление данных выполняется в разделах «Заявки», «Команды» и «Материалы»: правка здесь
                        запрещена, чтобы персональные данные не менялись в обход карточки заявки.
                      </p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </SectionCard>

      <SectionCard
        title="Регистрация обращения субъекта"
        description="Срок ответа — 10 рабочих дней со дня получения обращения (ст. 20 152-ФЗ)."
      >
        <form className="grid gap-5 md:grid-cols-2" onSubmit={registerRequest}>
          <SelectField
            id="pdn-kind"
            label="Что просит субъект"
            value={newKind}
            onChange={(event) => setNewKind(event.target.value)}
            options={REQUEST_KINDS}
          />
          <TextField
            id="pdn-name"
            label="Имя субъекта"
            required
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <TextField
            id="pdn-email"
            label="Электронная почта субъекта"
            type="email"
            required
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            hint="По этому адресу направляется ответ."
          />
          <TextField
            id="pdn-received"
            label="Дата получения обращения"
            type="date"
            value={newReceivedAt}
            onChange={(event) => setNewReceivedAt(event.target.value)}
            hint="От даты получения считается срок ответа — 10 рабочих дней (ст. 20 152-ФЗ). Пусто — сегодня."
          />
          <SelectField
            id="pdn-channel"
            label="Канал обращения"
            value={newChannel}
            onChange={(event) => setNewChannel(event.target.value)}
            options={[
              { value: 'email', title: 'Электронная почта' },
              { value: 'site_form', title: 'Форма на сайте' },
              { value: 'letter', title: 'Письменное заявление' },
              { value: 'phone', title: 'Телефонный звонок' },
              { value: 'in_person', title: 'Личное обращение' },
            ]}
          />
          <div className="md:col-span-2">
            <TextAreaField
              id="pdn-message"
              label="Содержание обращения"
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              hint="Как обратился субъект: письмо, форма на сайте, письменное заявление."
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" loading={busy}>
              Зарегистрировать обращение
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Обращения в работе"
        description={`Всего: ${requests.length}. Просроченные по сроку ответа выделены.`}
        actions={
          <div className="md:w-56">
            <SelectField
              id="pdn-status-filter"
              label="Состояние"
              value={requestFilter}
              onChange={(event) => setRequestFilter(event.target.value)}
              options={REQUEST_FILTERS}
              placeholder="Все"
            />
          </div>
        }
      >
        {requestsLoading ? (
          <p role="status" className="text-muted">Загружаем обращения…</p>
        ) : requests.length === 0 ? (
          <p className="text-muted">Обращений нет. Зарегистрируйте обращение, чтобы контролировать срок ответа.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {requests.map((request) => (
              <li key={request.id} className="border border-border p-4">
                <p className="font-medium">
                  {request.subject_name} · <span className="font-mono">{request.subject_email}</span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {REQUEST_KINDS.find((item) => item.value === request.kind)?.title ?? request.kind} · получено{' '}
                  {formatMoscowHuman(request.received_at)} · срок {formatMoscowHuman(request.due_at)}
                  {request.overdue ? <span className="text-danger"> · срок истёк</span> : null}
                </p>
                <p className="mt-1 text-sm">
                  Состояние: {REQUEST_STATUSES.find((item) => item.value === request.status)?.title ?? request.status}
                  {request.handled_by_email ? ` · ведёт ${request.handled_by_email}` : ''}
                </p>
                {request.message ? <p className="mt-2 text-sm">{request.message}</p> : null}
                {request.resolution ? <p className="mt-2 text-sm text-muted">Результат: {request.resolution}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {request.status === 'new' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      loading={busy}
                      onClick={() => {
                        setBusy(true);
                        void adminApi
                          .updatePdnRequest(request.id, { status: 'in_progress' })
                          .then(() => loadRequests())
                          .catch((caught: unknown) =>
                            setError(
                              caught instanceof AdminApiError ? caught.message : 'Не удалось взять обращение в работу.'
                            )
                          )
                          .finally(() => setBusy(false));
                      }}
                    >
                      Взять в работу
                    </Button>
                  ) : null}
                  {request.status !== 'done' ? (
                    <Button
                      type="button"
                      loading={busy}
                      onClick={() => {
                        setDecisionTarget({ request, status: 'done' });
                        setDecisionText('');
                        setError(null);
                      }}
                    >
                      Исполнено
                    </Button>
                  ) : null}
                  {request.status !== 'refused' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="border-danger text-danger"
                      loading={busy}
                      onClick={() => {
                        setDecisionTarget({ request, status: 'refused' });
                        setDecisionText('');
                        setError(null);
                      }}
                    >
                      Отказать
                    </Button>
                  ) : null}
                </div>

                {decisionTarget !== null && decisionTarget.request.id === request.id ? (
                  <div className="mt-3 border border-border p-4">
                    <p className="font-medium">
                      {decisionTarget.status === 'done'
                        ? 'Что сделано по обращению'
                        : 'Основание отказа'}{' '}
                      (обязательно)
                    </p>
                    <div className="mt-3">
                      <TextAreaField
                        id={`decision-${request.id}`}
                        label="Основание и результат"
                        value={decisionText}
                        maxLength={2000}
                        onChange={(event) => setDecisionText(event.target.value)}
                        hint="Например: сведения выгружены и направлены субъекту 12 октября; либо: законных оснований для удаления нет — данные нужны для исполнения договора."
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button type="button" loading={busy} onClick={() => void confirmDecision()}>
                        Сохранить решение
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setDecisionTarget(null);
                          setDecisionText('');
                        }}
                      >
                        Отменить
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Срок хранения данных"
        description="Обезличивание выполняется по расписанию: три года с завершения сезона, ежегодная проверка с записью в журнал."
      >
        <p className="max-w-measure text-sm text-muted">
          Проверка запускается командой <code className="font-mono">npm run retention</code> (предварительный просмотр —
          с ключом <code className="font-mono">--dry-run</code>). Каждый прогон фиксируется в таблице{' '}
          <code className="font-mono">pdn_retention_runs</code> и в журнале действий: видно, какой сезон и когда
          обезличен. Данные текущего сезона не затрагиваются.
        </p>
      </SectionCard>
    </div>
  );
}
