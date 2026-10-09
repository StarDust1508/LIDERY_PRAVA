import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AdminApiError,
  type AdminApplicationCard,
  type AdminConsent,
  type AdminDistributionConsent,
  adminApi,
  actLevelTitle,
  DISTRIBUTION_CATEGORIES,
  formatFileSize,
  formatMoscowHuman,
  MATERIAL_STATUS_TITLES,
  participantCategoryTitle,
  pluralize,
  materialTypeTitle,
  TECH_STATUS_TITLES,
  teamStatusTitle,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField, StatusBadge, TextAreaField, TextField } from '@shared/index';

// Карточка заявки: сведения об инициативе, участники со всеми полями
// Приложения № 1, наставники, материалы с проверкой, согласия с версией текста
// и сетевым адресом (п. 14.3) и панель технической проверки.

const DISTRIBUTION_TITLES = new Map<string, string>(DISTRIBUTION_CATEGORIES.map((item) => [item.code, item.title]));

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-2">
      <dt className="mono-label text-muted">{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? '—' : String(value)}</dd>
    </div>
  );
}

export function ApplicationPage() {
  const params = useParams();
  const applicationId = Number(params.id);
  const [card, setCard] = useState<AdminApplicationCard | null>(null);
  const [consents, setConsents] = useState<AdminConsent[]>([]);
  const [distribution, setDistribution] = useState<AdminDistributionConsent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [techStatus, setTechStatus] = useState('pending');
  const [rejectionReason, setRejectionReason] = useState('');
  // Подтверждения (ТЗ 07, п. 2.2): приёмка при красных отметках и отказ с
  // причиной — решения, которые нельзя принимать «одной кнопкой».
  const [acceptConfirmed, setAcceptConfirmed] = useState(false);
  const failedChecks = (card?.requirements_check ?? []).filter((check) => !check.passed);
  const [organizerNotes, setOrganizerNotes] = useState('');
  const [reviewDraft, setReviewDraft] = useState<Record<number, { status: string; comment: string; deadline: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.application(applicationId);
      setCard(data);
      setTechStatus(data.application.tech_status);
      setRejectionReason(data.application.tech_rejection_reason ?? '');
      setOrganizerNotes(data.application.organizer_notes ?? '');
      const consentData = await adminApi.applicationConsents(applicationId);
      setConsents(consentData.consents);
      setDistribution(consentData.distribution);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить заявку.');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Действие не выполнено.');
    } finally {
      setBusy(false);
    }
  }

  async function openFile(mediaId: string, fileName: string | null) {
    try {
      const blob = await adminApi.materialFile(mediaId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? `${caught.message} (${fileName ?? 'файл'})` : 'Файл недоступен.');
    }
  }

  if (loading && !card) {
    return (
      <main className="mx-auto max-w-container px-6 py-8">
        <p role="status">Загружаем заявку…</p>
      </main>
    );
  }
  if (!card) {
    return (
      <main className="mx-auto max-w-container px-6 py-8">
        <Alert tone="danger">{error ?? 'Заявка не найдена.'}</Alert>
      </main>
    );
  }

  const { application, participants, mentors, materials } = card;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={application.season_title}
        title={`Заявка № ${application.id} · ${application.team_name}`}
        lead={application.direction_title ? `Направление: ${application.direction_title}` : undefined}
        aside={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={application.tech_status} title={TECH_STATUS_TITLES[application.tech_status] ?? application.tech_status} />
            <StatusBadge status={application.team_status} title={teamStatusTitle(application.team_status)} />
            <Link
              to={`/evaluation/${application.team_id}`}
              className="mono-label border border-border-strong px-4 py-2 hover:border-accent hover:text-accent"
            >
              Оценочный лист
            </Link>
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="flex flex-wrap gap-3">
        <Link className="text-accent underline underline-offset-2" to={`/teams?q=${encodeURIComponent(application.team_name ?? '')}`}>
          Карточка команды
        </Link>
        <Link className="text-accent underline underline-offset-2" to={`/materials?team_id=${application.team_id}`}>
          Материалы команды
        </Link>
      </div>

      {/* Проверка требований (ТЗ 07, п. 2.2): Оргкомитет видит результат до
          допуска заявки, а не ищет расхождения вручную по документам. */}
      {card.requirements_check && card.requirements_check.length > 0 ? (
        <SectionCard
          title="Проверка требований"
          description="Возраст, численность, уникальность участников, направление и комплект материалов."
        >
          <ul className="flex flex-col gap-3">
            {card.requirements_check.map((check) => (
              <li key={check.code} className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 md:flex-row md:items-baseline md:justify-between">
                <span className="flex items-baseline gap-3">
                  <span
                    aria-hidden="true"
                    className={check.passed ? 'text-success' : 'text-danger'}
                    title={check.passed ? 'Пройдено' : 'Требует внимания'}
                  >
                    {check.passed ? '✓' : '✗'}
                  </span>
                  <span>{check.title}</span>
                </span>
                <span className="text-sm text-muted">{check.note}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {/* История заявки (ТЗ 07, п. 2.2): кто и что менял — без неё разбор
          «почему вернули» упирается в переписку. */}
      {card.history && card.history.length > 0 ? (
        <SectionCard title="История" description="Действия Оргкомитета и команды по заявке в обратном порядке.">
          <ul className="flex flex-col gap-3 text-sm">
            {card.history.slice(0, 40).map((record) => (
              <li key={record.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 md:flex-row md:items-baseline md:justify-between">
                <span>
                  <span className="mono-label">{record.action}</span>{' '}
                  <span className="text-muted">{record.entity}</span>
                </span>
                <span className="text-muted">
                  {record.user_name ?? record.actor_label ?? record.actor_type} · {formatMoscowHuman(record.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard title="Техническая проверка" description="Проверка комплектности по пунктам 7.4–7.5 Положения: допуск, замечания со сроком устранения или отказ.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            id="tech-status"
            label="Статус проверки"
            value={techStatus}
            onChange={(event) => setTechStatus(event.target.value)}
            options={Object.entries(TECH_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
            hint="«Принята» переводит команду в статус «допущена к первому этапу», «Отклонена» — в «требуются исправления»."
          />
          <div className="text-sm text-muted">
            <p>Проверено: {application.tech_checked_at ? formatMoscowHuman(application.tech_checked_at) : 'ещё не проверялось'}</p>
            <p>Источник: {application.source === 'site' ? 'форма на сайте' : application.source}</p>
            <p>Подана: {application.submitted_at ? formatMoscowHuman(application.submitted_at) : 'черновик'}</p>
            <p>Сетевой адрес: {application.ip ?? '—'}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          <TextAreaField
            id="rejection-reason"
            label="Причина отказа или замечания"
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            maxLength={2000}
            hint="Замечание увидят участники; Оргкомитет даёт не более двух рабочих дней на устранение."
          />
          <TextAreaField
            id="organizer-notes"
            label="Служебные заметки Оргкомитета"
            value={organizerNotes}
            onChange={(event) => setOrganizerNotes(event.target.value)}
            maxLength={5000}
            hint="Участникам не показываются."
          />
          <div>
            <div className="flex flex-col gap-3">
              {failedChecks.length > 0 && techStatus === 'accepted' ? (
                <div className="border border-danger p-3 text-sm">
                  <p className="font-medium text-danger">
                    Не пройдено проверок: {failedChecks.length}. Приёмка заявки с этими отметками означает решение
                    Оргкомитета допустить команду несмотря на них.
                  </p>
                  <label className="mt-2 flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={acceptConfirmed}
                      onChange={(event) => setAcceptConfirmed(event.target.checked)}
                    />
                    <span>Подтверждаю приёмку: расхождения проверены и допущены осознанно.</span>
                  </label>
                </div>
              ) : null}
              {techStatus === 'rejected' && rejectionReason.trim().length < 3 ? (
                <p className="text-sm text-danger">Укажите причину отказа: она сохраняется в карточке и в журнале.</p>
              ) : null}
              <div>
                <Button
                  loading={busy}
                  disabled={
                    (techStatus === 'rejected' && rejectionReason.trim().length < 3) ||
                    (techStatus === 'accepted' && failedChecks.length > 0 && !acceptConfirmed)
                  }
                  onClick={() =>
                    void run(async () => {
                      await adminApi.updateApplication(applicationId, {
                        tech_status: techStatus,
                        tech_rejection_reason: rejectionReason.trim() || null,
                        organizer_notes: organizerNotes.trim() || null,
                      });
                      setAcceptConfirmed(false);
                      return 'Решение по технической проверке сохранено.';
                    })
                  }
                >
                  Сохранить решение
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Законотворческая инициатива" description="Сведения по Приложению № 1.">
        <dl className="grid gap-x-8 text-sm md:grid-cols-2">
          <Field label="Наименование законопроекта" value={application.law_title} />
          <Field label="Уровень акта" value={actLevelTitle(application.act_level)} />
          <Field label="Субъект права законодательной инициативы" value={application.proposed_initiator} />
          <Field
            label="Единоличное участие"
            value={
              application.is_solo
                ? `да, согласовано ${application.solo_approved_at ? formatMoscowHuman(application.solo_approved_at) : '—'}`
                : 'нет'
            }
          />
          <Field label="Номер заявки" value={application.public_number} />
          <Field label="Содержание заблокировано" value={application.content_locked ? 'да (приём завершён)' : 'нет'} />
        </dl>
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <p>
            <span className="mono-label text-muted">Аннотация</span>
            <br />
            {application.annotation ?? '—'}
          </p>
          <p>
            <span className="mono-label text-muted">Использование систем искусственного интеллекта</span>
            <br />
            {application.ai_usage ? `да, цели: ${application.ai_usage_purpose ?? '—'}` : 'нет'}
          </p>
        </div>
      </SectionCard>

      <SectionCard title={`Участники (${pluralize(participants.length, ['человек', 'человека', 'человек'])})`} description="Первым указан капитан команды.">
        <div className="flex flex-col gap-6">
          {participants.map((participant) => (
            <div key={participant.id} className="border border-border p-4">
              <p className="mb-2 font-semibold">
                {participant.full_name} — {participant.role === 'captain' ? 'капитан команды' : 'участник'}
                {participant.is_minor ? ' · младше 18 лет' : ''}
              </p>
              <dl className="grid gap-x-8 text-sm md:grid-cols-2">
                <Field label="Дата рождения" value={formatMoscowHuman(participant.birth_date)} />
                <Field label="Категория" value={participantCategoryTitle(participant.category)} />
                <Field label="Гражданство" value={participant.citizenship} />
                <Field label="Регион, населённый пункт" value={[participant.region, participant.settlement].filter(Boolean).join(', ')} />
                <Field label="Организация" value={participant.organization} />
                <Field label="Факультет" value={participant.faculty} />
                <Field label="Курс" value={participant.course} />
                <Field label="Направление подготовки (должность)" value={participant.study_program ?? participant.position} />
                <Field label="Телефон" value={participant.phone} />
                <Field label="Почта" value={participant.email} />
                <Field label="ВКонтакте" value={participant.vk_url} />
                <Field label="Согласие ПДн" value={participant.consent_pdn ? 'да' : 'нет'} />
                <Field
                  label="Согласие законного представителя"
                  value={participant.is_minor ? (participant.consent_legal_representative ? 'да' : 'нет') : 'не требуется'}
                />
              </dl>
              <p className="mt-3 text-sm">
                <span className="mono-label text-muted">Компетенции</span>
                <br />
                {participant.competencies ?? '—'}
              </p>
              <p className="mt-2 text-sm">
                <span className="mono-label text-muted">Личный вклад</span>
                <br />
                {participant.personal_contribution ?? '—'}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={`Наставники (${mentors.length})`} description="Наставник не является членом команды (п. 4.9).">
        {mentors.length === 0 ? (
          <p className="text-sm text-muted">Наставники не заявлены.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {mentors.map((mentor) => (
              <dl key={mentor.id} className="grid gap-x-8 border-b border-border pb-3 text-sm md:grid-cols-2">
                <Field label="ФИО" value={mentor.full_name} />
                <Field label="Место работы, должность" value={[mentor.organization, mentor.position].filter(Boolean).join(', ')} />
                <Field label="Учёная степень" value={mentor.academic_degree ?? mentor.degree} />
                <Field label="Учёное звание" value={mentor.academic_title} />
                <Field label="Почта" value={mentor.email} />
                <Field label="Согласие ПДн" value={mentor.consent_pdn ? 'да' : 'нет'} />
              </dl>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={`Конкурсные материалы (${materials.length})`}
        description="Приёмка, возврат на доработку со сроком (не более двух рабочих дней, п. 7.5) или отказ."
      >
        {materials.length === 0 ? (
          <p className="text-sm text-muted">Материалы не загружены.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {materials.map((material) => {
              const title = materialTypeTitle(material.type);
              const draft = reviewDraft[material.id] ?? {
                status: material.status,
                comment: material.reviewer_comment ?? '',
                deadline: material.fix_deadline ? material.fix_deadline.slice(0, 16) : '',
              };
              return (
                <div key={material.id} className="border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{title}</p>
                    <StatusBadge
                      status={material.status === 'accepted' ? 'allowed' : material.status === 'uploaded' ? 'draft' : 'tech_rejected'}
                      title={MATERIAL_STATUS_TITLES[material.status] ?? material.status}
                    />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Версия {material.version} · {material.file_name ?? material.external_url ?? 'без файла'}
                    {material.file_size ? ` · ${formatFileSize(material.file_size)}` : ''} · загружено{' '}
                    {formatMoscowHuman(material.created_at)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {material.media_id ? (
                      <Button variant="secondary" onClick={() => void openFile(material.media_id as string, material.file_name ?? null)}>
                        Открыть файл
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <SelectField
                      id={`material-status-${material.id}`}
                      label="Решение"
                      value={draft.status}
                      onChange={(event) =>
                        setReviewDraft((current) => ({
                          ...current,
                          [material.id]: { ...draft, status: event.target.value },
                        }))
                      }
                      options={Object.entries(MATERIAL_STATUS_TITLES).map(([value, title]) => ({ value, title }))}
                    />
                    <TextAreaField
                      id={`material-comment-${material.id}`}
                      label="Замечание участнику"
                      value={draft.comment}
                      onChange={(event) =>
                        setReviewDraft((current) => ({ ...current, [material.id]: { ...draft, comment: event.target.value } }))
                      }
                      maxLength={2000}
                    />
                    <TextField
                      id={`material-deadline-${material.id}`}
                      label="Срок устранения"
                      type="datetime-local"
                      value={draft.deadline}
                      onChange={(event) =>
                        setReviewDraft((current) => ({ ...current, [material.id]: { ...draft, deadline: event.target.value } }))
                      }
                      hint="Оставьте пустым, если замечаний нет."
                    />
                  </div>
                  <div className="mt-3">
                    <Button
                      loading={busy}
                      onClick={() =>
                        void run(async () => {
                          await adminApi.reviewMaterial(material.id, {
                            status: draft.status,
                            comment: draft.comment.trim() || null,
                            fix_deadline: draft.deadline ? new Date(draft.deadline).toISOString() : null,
                          });
                          return `Решение по материалу «${title}» сохранено.`;
                        })
                      }
                    >
                      Сохранить решение
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={`Согласия (${consents.length})`}
        description="Электронная форма: фиксируются версия текста, дата, время и сетевой адрес (п. 14.3 Положения). Отозванные согласия выделены."
      >
        {consents.length === 0 ? (
          <p className="text-sm text-muted">Согласия не зафиксированы: заявка ещё не отправлена.</p>
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only-text">Согласия участников и наставников</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">Субъект</th>
                  <th scope="col" className="py-2 pr-4">Документ</th>
                  <th scope="col" className="py-2 pr-4">Версия</th>
                  <th scope="col" className="py-2 pr-4">Дано</th>
                  <th scope="col" className="py-2 pr-4">Сетевой адрес</th>
                  <th scope="col" className="py-2">Скан / отзыв</th>
                </tr>
              </thead>
              <tbody>
                {consents.map((consent) => (
                  <tr key={consent.id} className="border-b border-border">
                    <td className="py-2 pr-4">
                      {consent.participant_name ?? consent.mentor_name ?? 'команда'}
                      <span className="block text-muted">
                        {consent.subject_type === 'legal_representative'
                          ? 'законный представитель'
                          : consent.subject_type === 'mentor'
                            ? 'наставник'
                            : consent.subject_type === 'team'
                              ? 'команда'
                              : 'участник'}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{consent.document_title ?? consent.document_code}</td>
                    <td className="py-2 pr-4 font-mono">{consent.document_version}</td>
                    <td className="py-2 pr-4">{consent.accepted_at ? formatMoscowHuman(consent.accepted_at) : '—'}</td>
                    <td className="py-2 pr-4 font-mono">{consent.ip ?? '—'}</td>
                    <td className="py-2">
                      {consent.scan_media_id ? 'скан загружен' : '—'}
                      {consent.revoked_at ? <span className="block text-danger">отозвано {formatMoscowHuman(consent.revoked_at)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Согласия на мобильных — карточками (ТЗ 08, п. 3.6). */}
            <ul className="flex flex-col gap-4 md:hidden">
              {consents.map((consent) => (
                <li key={`card-${consent.id}`} className="border border-border p-4 text-sm">
                  <p className="font-semibold">{consent.participant_name ?? consent.mentor_name ?? 'команда'}</p>
                  <p className="text-muted">
                    {consent.subject_type === 'legal_representative'
                      ? 'законный представитель'
                      : consent.subject_type === 'mentor'
                        ? 'наставник'
                        : consent.subject_type === 'team'
                          ? 'команда'
                          : 'участник'}
                  </p>
                  <dl className="mt-3 flex flex-col gap-1">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Документ</dt>
                      <dd>{consent.document_title ?? consent.document_code}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Версия</dt>
                      <dd className="font-mono">{consent.document_version}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Дано</dt>
                      <dd>{consent.accepted_at ? formatMoscowHuman(consent.accepted_at) : '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Сетевой адрес</dt>
                      <dd className="font-mono">{consent.ip ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Скан / отзыв</dt>
                      <dd>
                        {consent.scan_media_id ? 'скан загружен' : '—'}
                        {consent.revoked_at ? ` · отозвано ${formatMoscowHuman(consent.revoked_at)}` : ''}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}

        {distribution.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-h3 font-semibold">Матрица Приложения № 12</h3>
            <p className="mt-1 text-sm text-muted">По каждой категории субъект отметил «разрешаю» или «не разрешаю».</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {distribution.map((item) => (
                <li key={`${item.participant_id}-${item.category_code}`} className="flex flex-wrap justify-between gap-3 border-b border-border pb-2">
                  <span>
                    {item.participant_name} · {DISTRIBUTION_TITLES.get(item.category_code) ?? item.category_code}
                  </span>
                  <span className={item.allowed ? 'text-success' : 'text-muted'}>
                    {item.allowed ? 'разрешаю' : 'не разрешаю'}
                    {item.conditions ? ` · условия: ${item.conditions}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </SectionCard>
    </main>
  );
}
