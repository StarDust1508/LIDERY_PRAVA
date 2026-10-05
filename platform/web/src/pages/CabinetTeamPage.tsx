import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type Direction,
  type Participant,
  type ParticipantCategory,
  PARTICIPANT_CATEGORIES,
  api,
  formatMoscowHuman,
  participantCategoryTitle,
  pluralize,
} from '@shared/index';
import { Alert, Button, CheckboxField, SelectField, TextAreaField, TextField } from '@shared/index';
import { useSeo } from '@/lib/seo';
import {
  type CabinetData,
  CabinetContactForm,
  CabinetLayout,
  CabinetLoadError,
  CabinetLoading,
  CabinetSection,
  CabinetSessionLost,
  ConfirmDialog,
  LockedNote,
  fetchCabinetData,
  participantEditBlockReason,
  teamEditBlockReason,
} from './CabinetActions';

// Раздел личного кабинета «Команда» (ТЗ 06, п. 2.1 и п. 3): состав, капитан команды,
// наставники и редактирование до блокировки.
//
// Правило интерфейса из ТЗ 06, п. 3: запрещённое действие не исчезает молча —
// кнопка остаётся на экране неактивной, а рядом написано, почему и до какого
// срока. Сами запреты проверяет сервер, интерфейс лишь объясняет их заранее.

interface ParticipantRow {
  id: number | null;
  full_name: string;
  birth_date: string;
  category: ParticipantCategory;
  email: string;
  phone: string;
  organization: string;
  position: string;
  education: string;
  citizenship: string;
  region: string;
  settlement: string;
  vk_url: string;
  competencies: string;
  personal_contribution: string;
  faculty: string;
  course: string;
  study_program: string;
  role: 'captain' | 'member';
  // Согласия фиксируются в мастере подачи; здесь они сохраняются как есть.
  consent_pdn: boolean;
  consent_distribution: boolean;
  consent_legal_representative: boolean;
}

interface MentorRow {
  full_name: string;
  organization: string;
  position: string;
  academic_degree: string;
  academic_title: string;
  email: string;
  phone: string;
  consent_pdn: boolean;
}

const EMPTY_PARTICIPANT: ParticipantRow = {
  id: null,
  full_name: '',
  birth_date: '',
  category: 'student',
  email: '',
  phone: '',
  organization: '',
  position: '',
  education: '',
  citizenship: '',
  region: '',
  settlement: '',
  vk_url: '',
  competencies: '',
  personal_contribution: '',
  faculty: '',
  course: '',
  study_program: '',
  role: 'member',
  consent_pdn: false,
  consent_distribution: false,
  consent_legal_representative: false,
};

const EMPTY_MENTOR: MentorRow = {
  full_name: '',
  organization: '',
  position: '',
  academic_degree: '',
  academic_title: '',
  email: '',
  phone: '',
  consent_pdn: false,
};

function toParticipantRow(participant: Participant): ParticipantRow {
  return {
    id: participant.id,
    full_name: participant.full_name,
    birth_date: participant.birth_date ? participant.birth_date.slice(0, 10) : '',
    category: (PARTICIPANT_CATEGORIES.find((item) => item.value === participant.category)?.value ??
      'student') as ParticipantCategory,
    email: participant.email,
    phone: participant.phone ?? '',
    organization: participant.organization ?? '',
    position: participant.position ?? '',
    education: participant.education ?? '',
    citizenship: participant.citizenship ?? '',
    region: participant.region ?? '',
    settlement: participant.settlement ?? '',
    vk_url: participant.vk_url ?? '',
    competencies: participant.competencies ?? '',
    personal_contribution: participant.personal_contribution ?? '',
    faculty: participant.faculty ?? '',
    course: participant.course === null ? '' : String(participant.course),
    study_program: participant.study_program ?? '',
    role: participant.role,
    consent_pdn: participant.consent_pdn,
    consent_distribution: participant.consent_distribution,
    consent_legal_representative: participant.consent_legal_representative,
  };
}

/** Возраст на дату окончания приёма заявок: подсказка до сохранения. */
function ageOnDate(birthDate: string, reference: string | null): number | null {
  if (birthDate === '') return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const at = reference ? new Date(reference) : new Date();
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function CabinetTeamPage() {
  useSeo({
    title: 'Команда в личном кабинете',
    description:
      'Состав команды конкурса «Лидеры права – 2027»: участники, капитан команды, наставники и правила изменения состава до окончания приёма заявок.',
    path: '/cabinet/team',
  });

  const [data, setData] = useState<CabinetData | null>(null);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setSessionLost(false);
    try {
      const fresh = await fetchCabinetData();
      setData(fresh);
      setDirections(await api.directions().catch(() => []));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSessionLost(true);
        setData(null);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить данные личного кабинета.');
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
        <CabinetLoading />
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
        <CabinetLoadError message={error ?? 'Не удалось получить данные команды.'} onRetry={() => void load()} />
      </main>
    );
  }

  return <TeamSection data={data} directions={directions} onReload={load} />;
}

function TeamSection({
  data,
  directions,
  onReload,
}: {
  data: CabinetData;
  directions: Direction[];
  onReload: () => Promise<void>;
}) {
  const team = data.team;
  const compositionLock = teamEditBlockReason(data);
  const participantLock = participantEditBlockReason(data);
  const locked = compositionLock !== null;

  const [name, setName] = useState(team.name);
  const [directionId, setDirectionId] = useState(team.direction?.id ? String(team.direction.id) : '');
  const [participants, setParticipants] = useState<ParticipantRow[]>(() => {
    const rows = team.participants.map(toParticipantRow);
    // Капитан команды всегда один: если данных нет, им становится первый участник.
    if (rows.length > 0 && !rows.some((row) => row.role === 'captain')) {
      rows[0] = { ...(rows[0] as ParticipantRow), role: 'captain' };
    }
    return rows;
  });
  const [mentors, setMentors] = useState<MentorRow[]>(() =>
    team.mentors.map((mentor) => ({
      full_name: mentor.full_name,
      organization: mentor.organization ?? '',
      position: mentor.position ?? '',
      academic_degree: mentor.academic_degree ?? mentor.degree ?? '',
      academic_title: mentor.academic_title ?? '',
      email: mentor.email ?? '',
      phone: mentor.phone ?? '',
      consent_pdn: mentor.consent_pdn,
    }))
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [compositionAcknowledged, setCompositionAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  function patchParticipant(index: number, patch: Partial<ParticipantRow>) {
    setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setCaptain(index: number) {
    setParticipants((rows) => rows.map((row, i) => ({ ...row, role: i === index ? 'captain' : 'member' })));
  }

  function addParticipant() {
    if (participants.length >= 4) return;
    setParticipants((rows) => [...rows, { ...EMPTY_PARTICIPANT }]);
  }

  function removeParticipant(index: number) {
    setParticipants((rows) => {
      const next = rows.filter((_, i) => i !== index);
      if (next.length > 0 && !next.some((row) => row.role === 'captain')) {
        next[0] = { ...(next[0] as ParticipantRow), role: 'captain' };
      }
      return next;
    });
  }

  function patchMentor(index: number, patch: Partial<MentorRow>) {
    setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** Изменение состава относительно сохранённого: добавлены или удалены люди. */
  const compositionChanged =
    participants.length !== team.participants.length ||
    participants.some((row) => row.id === null) ||
    participants.some((row) => {
      const original = team.participants.find((participant) => participant.id === row.id);
      return original !== undefined && original.role !== row.role;
    }) ||
    mentors.length !== team.mentors.length;

  const localErrors: string[] = [];
  if (name.trim() === '') localErrors.push('Укажите название команды.');
  if (participants.length === 0) localErrors.push('В команде должен быть хотя бы один участник (п. 4.3 Положения).');
  if (participants.length > 4) localErrors.push('В команде не может быть больше четырёх участников (п. 4.3 Положения).');
  if (participants.filter((row) => row.role === 'captain').length !== 1) {
    localErrors.push('Отметьте одного капитана команды.');
  }
  participants.forEach((row, index) => {
    const label = row.full_name.trim() === '' ? `Участник ${index + 1}` : row.full_name.trim();
    const prefix = `Участник ${index + 1}`;
    if (row.full_name.trim() === '') localErrors.push(`${prefix}: укажите ФИО.`);
    if (row.birth_date === '') localErrors.push(`${prefix}: укажите дату рождения.`);
    if (row.email.trim() === '') localErrors.push(`${prefix}: укажите адрес электронной почты.`);
    const age = ageOnDate(row.birth_date, team.application_close_at);
    if (age !== null && (age < 16 || age > 35)) {
      localErrors.push(
        `${prefix}: на дату окончания приёма заявок участнику ${pluralize(age, ['год', 'года', 'лет'])} — допустимый возраст от 16 до 35 лет (п. 4.1 Положения). Участник «${label}».`
      );
    }
    if (!row.consent_pdn) {
      localErrors.push(
        `${prefix}: не зафиксировано согласие на обработку персональных данных — отметьте согласия в мастере подачи.`
      );
    }
    if (age !== null && age < 18 && !row.consent_legal_representative) {
      localErrors.push(
        `${prefix}: участник младше 18 лет — нужно согласие законного представителя (п. 4.8 Положения).`
      );
    }
  });
  if (mentors.length > 2) localErrors.push('У команды может быть не более двух наставников (п. 4.9 Положения).');
  mentors.forEach((row, index) => {
    if (row.full_name.trim() === '') localErrors.push(`Наставник ${index + 1}: укажите ФИО.`);
  });

  async function save() {
    setError(null);
    setDetails([]);
    setNotice(null);

    if (localErrors.length > 0) {
      setError('Проверьте состав команды: есть незаполненные обязательные поля.');
      setDetails(localErrors);
      return;
    }

    setBusy(true);
    try {
      await api.cabinetSaveTeam({
        name: name.trim(),
        direction_id: directionId === '' ? null : Number(directionId),
        participants: participants.map((row) => ({
          id: row.id,
          full_name: row.full_name.trim(),
          birth_date: row.birth_date,
          category: row.category,
          organization: row.organization.trim() || null,
          position: row.position.trim() || null,
          education: row.education.trim() || null,
          email: row.email.trim(),
          phone: row.phone.trim() || null,
          role: row.role,
          consent_pdn: row.consent_pdn,
          consent_distribution: row.consent_distribution,
          consent_legal_representative: row.consent_legal_representative,
          citizenship: row.citizenship.trim() || null,
          region: row.region.trim() || null,
          settlement: row.settlement.trim() || null,
          vk_url: row.vk_url.trim() || null,
          competencies: row.competencies.trim() || null,
          personal_contribution: row.personal_contribution.trim() || null,
          faculty: row.faculty.trim() || null,
          course: row.course.trim() === '' ? null : Number(row.course),
          study_program: row.study_program.trim() || null,
        })),
        mentors: mentors.map((row) => ({
          full_name: row.full_name.trim(),
          organization: row.organization.trim() || null,
          position: row.position.trim() || null,
          academic_degree: row.academic_degree.trim() || null,
          academic_title: row.academic_title.trim() || null,
          email: row.email.trim() || null,
          phone: row.phone.trim() || null,
          consent_pdn: row.consent_pdn,
        })),
      });
      setConfirmOpen(false);
      setCompositionAcknowledged(false);
      setNotice('Данные команды сохранены.');
      await onReload();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось сохранить данные команды. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CabinetLayout
      data={data}
      title="Команда"
      lead="Название, направление конкурса, участники и наставники. Изменения сохраняются только до блокировки состава."
      onReload={onReload}
    >
      <LockedNote reason={compositionLock} />
      {participantLock && participantLock !== compositionLock ? <LockedNote reason={participantLock} /> : null}

      {error ? (
        <Alert tone="danger" title="Изменения не сохранены" details={details.length > 0 ? details : undefined}>
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <CabinetSection title="Название и направление" description="Так команда указывается в протоколах этапов.">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="team-name"
            label="Название команды"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            disabled={locked}
            hint={locked ? 'Название меняется только до окончания приёма заявок.' : undefined}
          />
          <SelectField
            id="team-direction"
            label="Направление конкурса"
            value={directionId}
            onChange={(event) => setDirectionId(event.target.value)}
            placeholder="Направление не выбрано"
            options={directions.map((direction) => ({ value: direction.id, title: direction.title }))}
            disabled={locked}
            hint="Направление определяет состав экспертов на первом этапе."
          />
        </div>
        <p className="mt-4 text-sm text-muted">
          Организация и город команды: {team.organization ?? '—'}, {team.city ?? '—'}. Эти поля заполняются в мастере
          подачи заявки.{' '}
          <Link to="/apply" className="text-accent underline underline-offset-2">
            Открыть мастер подачи
          </Link>
          .
        </p>
      </CabinetSection>

      <CabinetSection
        title="Участники"
        description="От одного до четырёх участников, ровно один капитан команды. Возраст — от 16 до 35 лет на дату окончания приёма заявок (п. 4.1, 4.3 Положения)."
      >
        <div className="flex flex-col gap-6">
          {participants.map((row, index) => (
            <ParticipantCard
              key={row.id ?? `new-${index}`}
              index={index}
              row={row}
              disabled={locked}
              errors={localErrors}
              onPatch={(patch) => patchParticipant(index, patch)}
              onCaptain={() => setCaptain(index)}
              onRemove={participants.length > 1 ? () => removeParticipant(index) : undefined}
            />
          ))}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="secondary"
              onClick={addParticipant}
              disabled={locked || participants.length >= 4}
            >
              Добавить участника
            </Button>
            {locked ? (
              <p className="text-sm text-muted">Добавление участников недоступно: состав заблокирован.</p>
            ) : participants.length >= 4 ? (
              <p className="text-sm text-muted">В команде уже четыре участника — это предельный состав.</p>
            ) : null}
          </div>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Наставники"
        description="Не более двух наставников (п. 4.9 Положения). Наставник не входит в состав выступающих на финале."
      >
        <div className="flex flex-col gap-6">
          {mentors.length === 0 ? (
            <p className="text-sm text-muted">Наставники не указаны.</p>
          ) : (
            mentors.map((row, index) => (
              <fieldset key={`mentor-${index}`} className="border border-border px-4 py-4">
                <legend className="mono-label px-1 text-muted">Наставник {index + 1}</legend>
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField
                    id={`mentor-name-${index}`}
                    label="Фамилия, имя, отчество"
                    required
                    value={row.full_name}
                    onChange={(event) => patchMentor(index, { full_name: event.target.value })}
                    maxLength={200}
                    disabled={locked}
                  />
                  <TextField
                    id={`mentor-organization-${index}`}
                    label="Организация"
                    value={row.organization}
                    onChange={(event) => patchMentor(index, { organization: event.target.value })}
                    maxLength={300}
                    disabled={locked}
                  />
                  <TextField
                    id={`mentor-position-${index}`}
                    label="Должность"
                    value={row.position}
                    onChange={(event) => patchMentor(index, { position: event.target.value })}
                    maxLength={300}
                    disabled={locked}
                  />
                  <TextField
                    id={`mentor-degree-${index}`}
                    label="Учёная степень"
                    value={row.academic_degree}
                    onChange={(event) => patchMentor(index, { academic_degree: event.target.value })}
                    maxLength={200}
                    disabled={locked}
                  />
                  <TextField
                    id={`mentor-title-${index}`}
                    label="Учёное звание"
                    value={row.academic_title}
                    onChange={(event) => patchMentor(index, { academic_title: event.target.value })}
                    maxLength={200}
                    disabled={locked}
                  />
                  <TextField
                    id={`mentor-email-${index}`}
                    label="Адрес электронной почты"
                    type="email"
                    value={row.email}
                    onChange={(event) => patchMentor(index, { email: event.target.value })}
                    maxLength={200}
                    disabled={locked}
                  />
                  <TextField
                    id={`mentor-phone-${index}`}
                    label="Телефон"
                    type="tel"
                    value={row.phone}
                    onChange={(event) => patchMentor(index, { phone: event.target.value })}
                    maxLength={32}
                    disabled={locked}
                  />
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  <CheckboxField
                    id={`mentor-consent-${index}`}
                    label="Согласие на обработку персональных данных получено"
                    checked={row.consent_pdn}
                    onChange={(checked) => patchMentor(index, { consent_pdn: checked })}
                  />
                  {mentors.length > 1 ? (
                    <div>
                      <Button
                        variant="quiet"
                        onClick={() => setMentors((rows) => rows.filter((_, i) => i !== index))}
                        disabled={locked}
                      >
                        Удалить наставника
                      </Button>
                    </div>
                  ) : null}
                </div>
              </fieldset>
            ))
          )}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="secondary"
              onClick={() => setMentors((rows) => [...rows, { ...EMPTY_MENTOR }])}
              disabled={locked || mentors.length >= 2}
            >
              Добавить наставника
            </Button>
            {locked ? (
              <p className="text-sm text-muted">Изменение наставников недоступно: состав заблокирован.</p>
            ) : mentors.length >= 2 ? (
              <p className="text-sm text-muted">У команды уже два наставника — это предельное число.</p>
            ) : null}
          </div>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Сохранение изменений"
        description="Изменение состава команды допускается однократно и подтверждается отдельно."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Согласия участников фиксируются в мастере подачи заявки: дата, время, сетевой адрес и версия текста
            согласия. Здесь они только сохраняются. Если участнику нужно отметить согласие впервые,{' '}
            <Link to="/apply" className="text-accent underline underline-offset-2">
              перейдите в мастер подачи
            </Link>
            .
          </p>

          {compositionChanged ? (
            <CheckboxField
              id="composition-acknowledged"
              label="Понимаю: изменение состава допускается однократно, при этом в команде остаётся не менее половины прежнего состава (п. 4.5 Положения)"
              checked={compositionAcknowledged}
              onChange={setCompositionAcknowledged}
              hint="Если состав уже менялся, сохранить его снова получится только по решению Оргкомитета."
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={locked || (compositionChanged && !compositionAcknowledged)}
            >
              Сохранить данные команды
            </Button>
            {locked ? (
              <p className="text-sm text-muted">Сохранение недоступно: {compositionLock}</p>
            ) : compositionChanged && !compositionAcknowledged ? (
              <p className="text-sm text-muted">Подтвердите условие изменения состава, чтобы сохранить данные.</p>
            ) : null}
          </div>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Связаться с организаторами"
        description="Если состав нужно изменить после блокировки, напишите в Оргкомитет."
      >
        <CabinetContactForm
          showTopic
          defaultTopic="application"
          compactNote="Приложите, кого нужно добавить или удалить и почему: Оргкомитет отвечает на адрес электронной почты капитана команды."
        />
      </CabinetSection>

      <ConfirmDialog
        open={confirmOpen}
        title={compositionChanged ? 'Изменить состав команды?' : 'Сохранить данные команды?'}
        confirmLabel="Сохранить изменения"
        busy={busy}
        onConfirm={() => void save()}
        onClose={() => setConfirmOpen(false)}
      >
        {compositionChanged ? (
          <>
            <p>
              Состав команды меняется: участников станет {participants.length}, наставников — {mentors.length}.
              Изменение состава допускается однократно, с сохранением не менее половины прежнего состава (п. 4.5
              Положения).
            </p>
            <p className="text-muted">
              Капитан команды: {participants.find((row) => row.role === 'captain')?.full_name.trim() || 'не указан'}.
              Удалённые участники потеряют доступ к комплекту материалов этой команды.
            </p>
          </>
        ) : (
          <p>
            Будут сохранены исправленные данные участников и наставников: ФИО, контакты, образование, направление
            подготовки. Структура команды при этом не меняется.
          </p>
        )}
        <p className="text-muted">
          После сохранения данные попадут в карточку команды у Оргкомитета: {formatMoscowHuman(new Date().toISOString())}
          . Это время фиксируется как дата изменения.
        </p>
      </ConfirmDialog>
    </CabinetLayout>
  );
}

function ParticipantCard({
  index,
  row,
  disabled,
  errors,
  onPatch,
  onCaptain,
  onRemove,
}: {
  index: number;
  row: ParticipantRow;
  disabled: boolean;
  errors: string[];
  onPatch: (patch: Partial<ParticipantRow>) => void;
  onCaptain: () => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(disabled || row.id === null);
  const panelId = `participant-fields-${index}`;
  const caption = row.full_name.trim() === '' ? `Участник ${index + 1}` : row.full_name.trim();
  const isCaptain = row.role === 'captain';
  const rowErrors = errors.filter((message) => message.startsWith(`Участник ${index + 1}:`));

  return (
    <fieldset className="border border-border px-4 py-4">
      <legend className="mono-label px-1 text-muted">
        Участник {index + 1}
        {isCaptain ? ' · капитан команды' : ''}
      </legend>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {caption}
          <span className="text-muted">
            {' '}
            · {participantCategoryTitle(row.category)}
            {row.email ? ` · ${row.email}` : ''}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="team-captain"
              value={index}
              checked={isCaptain}
              onChange={onCaptain}
              disabled={disabled}
              className="h-4 w-4 accent-[var(--accent-solid)]"
            />
            Капитан команды
          </label>
          <Button
            variant="quiet"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Свернуть данные' : 'Изменить данные'}
          </Button>
        </div>
      </div>

      {rowErrors.length > 0 ? (
        <ul role="alert" className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-danger">
          {rowErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div id={panelId} className="mt-4 flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              id={`participant-name-${index}`}
              label="Фамилия, имя, отчество"
              required
              value={row.full_name}
              onChange={(event) => onPatch({ full_name: event.target.value })}
              maxLength={200}
              disabled={disabled}
            />
            <TextField
              id={`participant-birth-${index}`}
              label="Дата рождения"
              type="date"
              required
              value={row.birth_date}
              onChange={(event) => onPatch({ birth_date: event.target.value })}
              disabled={disabled}
              hint="Возраст считается на дату окончания приёма заявок."
            />
            <SelectField
              id={`participant-category-${index}`}
              label="Категория участника"
              value={row.category}
              onChange={(event) => onPatch({ category: event.target.value as ParticipantCategory })}
              options={PARTICIPANT_CATEGORIES.map((item) => ({ value: item.value, title: item.title }))}
              disabled={disabled}
            />
            <TextField
              id={`participant-email-${index}`}
              label="Адрес электронной почты"
              type="email"
              required
              value={row.email}
              onChange={(event) => onPatch({ email: event.target.value })}
              maxLength={200}
              disabled={disabled}
            />
            <TextField
              id={`participant-phone-${index}`}
              label="Телефон"
              type="tel"
              value={row.phone}
              onChange={(event) => onPatch({ phone: event.target.value })}
              maxLength={32}
              disabled={disabled}
            />
            <TextField
              id={`participant-organization-${index}`}
              label="Образовательная организация или место работы"
              value={row.organization}
              onChange={(event) => onPatch({ organization: event.target.value })}
              maxLength={300}
              disabled={disabled}
            />
            <TextField
              id={`participant-position-${index}`}
              label="Должность или статус"
              value={row.position}
              onChange={(event) => onPatch({ position: event.target.value })}
              maxLength={300}
              disabled={disabled}
            />
            <TextField
              id={`participant-education-${index}`}
              label="Образование"
              value={row.education}
              onChange={(event) => onPatch({ education: event.target.value })}
              maxLength={300}
              disabled={disabled}
            />
            <TextField
              id={`participant-citizenship-${index}`}
              label="Гражданство"
              value={row.citizenship}
              onChange={(event) => onPatch({ citizenship: event.target.value })}
              maxLength={120}
              disabled={disabled}
            />
            <TextField
              id={`participant-region-${index}`}
              label="Субъект Российской Федерации"
              value={row.region}
              onChange={(event) => onPatch({ region: event.target.value })}
              maxLength={200}
              disabled={disabled}
            />
            <TextField
              id={`participant-settlement-${index}`}
              label="Населённый пункт"
              value={row.settlement}
              onChange={(event) => onPatch({ settlement: event.target.value })}
              maxLength={200}
              disabled={disabled}
            />
            <TextField
              id={`participant-vk-${index}`}
              label="Ссылка на страницу «ВКонтакте»"
              type="url"
              value={row.vk_url}
              onChange={(event) => onPatch({ vk_url: event.target.value })}
              maxLength={300}
              disabled={disabled}
            />
            <TextField
              id={`participant-faculty-${index}`}
              label="Факультет или институт"
              value={row.faculty}
              onChange={(event) => onPatch({ faculty: event.target.value })}
              maxLength={300}
              disabled={disabled}
            />
            <TextField
              id={`participant-course-${index}`}
              label="Курс обучения"
              type="number"
              min={1}
              max={6}
              value={row.course}
              onChange={(event) => onPatch({ course: event.target.value })}
              disabled={disabled}
              hint="Допустимо от 1 до 6."
            />
            <TextField
              id={`participant-program-${index}`}
              label="Направление подготовки"
              value={row.study_program}
              onChange={(event) => onPatch({ study_program: event.target.value })}
              maxLength={300}
              disabled={disabled}
            />
          </div>

          <TextAreaField
            id={`participant-competencies-${index}`}
            label="Компетенции участника"
            value={row.competencies}
            onChange={(event) => onPatch({ competencies: event.target.value })}
            maxLength={800}
            disabled={disabled}
          />
          <TextAreaField
            id={`participant-contribution-${index}`}
            label="Личный вклад в законотворческую инициативу"
            value={row.personal_contribution}
            onChange={(event) => onPatch({ personal_contribution: event.target.value })}
            maxLength={1000}
            disabled={disabled}
          />

          <div className="flex flex-col gap-3">
            <CheckboxField
              id={`participant-consent-pdn-${index}`}
              label="Согласие на обработку персональных данных зафиксировано"
              checked={row.consent_pdn}
              onChange={(checked) => onPatch({ consent_pdn: checked })}
              hint="Согласие даётся в мастере подачи заявки; здесь только отображается."
            />
            <CheckboxField
              id={`participant-consent-distribution-${index}`}
              label="Согласие на распространение персональных данных зафиксировано"
              checked={row.consent_distribution}
              onChange={(checked) => onPatch({ consent_distribution: checked })}
            />
            <CheckboxField
              id={`participant-consent-legal-${index}`}
              label="Согласие законного представителя зафиксировано"
              checked={row.consent_legal_representative}
              onChange={(checked) => onPatch({ consent_legal_representative: checked })}
              hint="Нужно для участников младше 18 лет: электронная отметка и скан подписанного бланка (Приложение № 11)."
            />
          </div>

          {onRemove ? (
            <div>
              <Button variant="quiet" onClick={onRemove} disabled={disabled}>
                Удалить участника
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
