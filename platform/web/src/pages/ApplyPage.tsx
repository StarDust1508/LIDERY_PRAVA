import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ACT_LEVELS,
  ApiError,
  DISTRIBUTION_CATEGORIES,
  LINK_ALLOWED_MATERIAL_TYPES,
  LINK_ONLY_MATERIAL_TYPES,
  MASTER_STEPS,
  PARTICIPANT_CATEGORIES,
  type ActLevel,
  type Direction,
  type DistributionCategoryCode,
  type Material,
  type MaterialRequirement,
  type Participant,
  type ParticipantCategory,
  type Season,
  type TeamResponse,
  api,
  formatFileSize,
  formatMoscowHuman,
  formatSavedAt,
  MATERIAL_STATUS_TITLES,
  pluralize,
  Alert,
  Button,
  CheckboxField,
  SectionCard,
  SelectField,
  StatusBadge,
  StepProgress,
  TextAreaField,
  TextField,
} from '@shared/index';
import { UniversityField } from '@/components/UniversityField';
import { clearDraft, createIdempotencyKey, loadDraft, saveDraft, type ApplicationDraftRef } from '@/lib/session';

// Мастер подачи заявки: шесть шагов от сведений о команде до отправки.
// Шаги 2–6 работают по ссылке доступа, полученной при создании заявки, поэтому
// команде не нужно входить в кабинет, пока заявка не отправлена.
// Все проверки выполняются на сервере; здесь — подсказки и показ замечаний.

interface ParticipantRow {
  id: number | null;
  full_name: string;
  birth_date: string;
  category: ParticipantCategory;
  email: string;
  phone: string;
  role: 'captain' | 'member';
  consent_pdn: boolean;
  consent_distribution: boolean;
  consent_legal_representative: boolean;
  // Поля Приложения № 1.
  organization: string;
  citizenship: string;
  region: string;
  settlement: string;
  vk_url: string;
  competencies: string;
  personal_contribution: string;
  faculty: string;
  course: string;
  study_program: string;
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

function participantToRow(participant: Participant): ParticipantRow {
  return {
    id: participant.id,
    full_name: participant.full_name,
    birth_date: participant.birth_date.slice(0, 10),
    category: participant.category as ParticipantCategory,
    email: participant.email,
    phone: participant.phone ?? '',
    role: participant.role,
    consent_pdn: participant.consent_pdn,
    consent_distribution: participant.consent_distribution,
    consent_legal_representative: participant.consent_legal_representative,
    organization: participant.organization ?? '',
    citizenship: participant.citizenship ?? '',
    region: participant.region ?? '',
    settlement: participant.settlement ?? '',
    vk_url: participant.vk_url ?? '',
    competencies: participant.competencies ?? '',
    personal_contribution: participant.personal_contribution ?? '',
    faculty: participant.faculty ?? '',
    course: participant.course === null ? '' : String(participant.course),
    study_program: participant.study_program ?? '',
  };
}

const EMPTY_PARTICIPANT: ParticipantRow = {
  id: null,
  full_name: '',
  birth_date: '',
  category: 'student',
  email: '',
  phone: '',
  role: 'member',
  consent_pdn: false,
  consent_distribution: false,
  consent_legal_representative: false,
  organization: '',
  citizenship: 'Российская Федерация',
  region: '',
  settlement: '',
  vk_url: '',
  competencies: '',
  personal_contribution: '',
  faculty: '',
  course: '',
  study_program: '',
};

export function ApplyPage() {
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<Season | null>(null);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [draft, setDraft] = useState<ApplicationDraftRef | null>(() => loadDraft());
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Шаг 1: команда и инициатива.
  const [teamName, setTeamName] = useState('');
  const [organization, setOrganization] = useState('');
  const [city, setCity] = useState('');
  const [directionId, setDirectionId] = useState('');
  const [lawTitle, setLawTitle] = useState('');
  const [actLevel, setActLevel] = useState<ActLevel>('federal');
  const [proposedInitiator, setProposedInitiator] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [aiUsage, setAiUsage] = useState(false);
  const [aiUsagePurpose, setAiUsagePurpose] = useState('');
  const [isSolo, setIsSolo] = useState(false);
  const [soloApprovedAt, setSoloApprovedAt] = useState('');
  const [captainName, setCaptainName] = useState('');
  const [captainBirthDate, setCaptainBirthDate] = useState('');
  const [captainCategory, setCaptainCategory] = useState<ParticipantCategory>('student');
  const [captainEmail, setCaptainEmail] = useState('');
  const [captainPhone, setCaptainPhone] = useState('');

  // Шаги 2–5.
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [mentors, setMentors] = useState<MentorRow[]>([{ ...EMPTY_MENTOR }]);
  const [requirements, setRequirements] = useState<MaterialRequirement[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  // Значения полей «ссылка на публикацию» по типам материалов.
  const [linkValues, setLinkValues] = useState<Record<string, string>>({});
  const [confirmRegulation, setConfirmRegulation] = useState(false);
  const [imageLicense, setImageLicense] = useState(false);
  // Согласие на информационные сообщения (ст. 18 38-ФЗ): необязательное и
  // показывается только тогда, когда текст согласия опубликован.
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [mailingConsentAvailable, setMailingConsentAvailable] = useState(false);
  const [distribution, setDistribution] = useState<Record<number, Partial<Record<DistributionCategoryCode, boolean>>>>({});
  const [distributionConditions, setDistributionConditions] = useState('');
  const [submitted, setSubmitted] = useState<{ public_number: string; submitted_at: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const token = draft?.access_token ?? null;
  // Прямая ссылка на вход: тот же адрес, что открывается по кнопке «Личный
  // кабинет». Токен не показывается в списке параметров, а вставляется как есть.
  const directAccessPath = token ? `/cabinet/access?token=${encodeURIComponent(token)}` : null;
  const directAccessUrl =
    directAccessPath === null
      ? null
      : `${typeof window === 'undefined' ? '' : window.location.origin}${directAccessPath}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [seasonResponse, directionsResponse] = await Promise.all([api.season(), api.directions()]);
        if (!active) return;
        setSeason(seasonResponse.season);
        setDirections(directionsResponse);
        // Текст согласия на рассылку утверждается отдельно: пока документ не
        // опубликован, согласие не запрашивается (иначе согласие берётся с
        // несуществующего текста).
        try {
          const documents = await api.documents();
          if (!active) return;
          setMailingConsentAvailable(documents.some((item) => item.type === 'mailing_consent'));
        } catch {
          // Список документов недоступен — согласие на рассылку не показываем.
        }
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить данные конкурса.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshCabinet = useCallback(
    async (accessToken: string) => {
      const [teamData, materialsData, requirementsData] = await Promise.all([
        api.cabinetTeam(accessToken),
        api.cabinetMaterials(accessToken),
        api.materialRequirements('selection'),
      ]);
      setTeam(teamData);
      setParticipants(teamData.participants.map(participantToRow));
      setMentors(
        teamData.mentors.length > 0
          ? teamData.mentors.map((mentor) => ({
              full_name: mentor.full_name,
              organization: mentor.organization ?? '',
              position: mentor.position ?? '',
              academic_degree: mentor.academic_degree ?? mentor.degree ?? '',
              academic_title: mentor.academic_title ?? '',
              email: mentor.email ?? '',
              phone: mentor.phone ?? '',
              consent_pdn: mentor.consent_pdn,
            }))
          : [{ ...EMPTY_MENTOR }]
      );
      setMaterials(materialsData);
      setRequirements(requirementsData.requirements);
      setMaxStep((value) => Math.max(value, teamData.participants.length > 0 ? 1 : 0));

      // Возвращаясь в мастер, команда должна видеть свои же данные, а не пустые
      // поля: иначе кажется, что заявка пропала, и её создают заново.
      setTeamName(teamData.name ?? '');
      setOrganization(teamData.organization ?? '');
      setCity(teamData.city ?? '');
      setDirectionId(teamData.direction ? String(teamData.direction.id) : '');
      const initiative = teamData.initiative;
      if (initiative) {
        setLawTitle(initiative.law_title ?? '');
        setActLevel((initiative.act_level as ActLevel) ?? 'federal');
        setProposedInitiator(initiative.proposed_initiator ?? '');
        setAnnotation(initiative.annotation ?? '');
        setAiUsage(initiative.ai_usage === true);
        setAiUsagePurpose(initiative.ai_usage_purpose ?? '');
        setIsSolo(initiative.is_solo === true);
        setSoloApprovedAt(initiative.solo_approved_at ? String(initiative.solo_approved_at).slice(0, 10) : '');
      }
    },
    []
  );

  useEffect(() => {
    if (!draft) return;
    void refreshCabinet(draft.access_token).catch((caught: unknown) => {
      if (caught instanceof ApiError && caught.status === 401) {
        clearDraft();
        setDraft(null);
        setError('Ссылка доступа больше не действует. Создайте заявку заново или войдите в кабинет по номеру заявки.');
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить данные заявки.');
    });
  }, [draft, refreshCabinet]);

  // Мастер должен продолжаться с любого устройства: если черновика в браузере
  // нет, но команда вошла в кабинет, заявка подхватывается по сессионной cookie.
  // Иначе команда создала бы вторую заявку и получила отказ по пункту 4.4.
  useEffect(() => {
    if (draft || loading) return;
    let active = true;
    void (async () => {
      try {
        const session = await api.cabinetSession();
        if (!active || !session.authenticated || !session.team) return;
        const teamData = await api.cabinetTeam();
        if (!active) return;
        // Пустая ссылка доступа означает работу по cookie: api не добавит заголовок.
        const restored: ApplicationDraftRef = {
          public_number: teamData.public_number ?? '',
          access_token: '',
          team_name: teamData.name,
          created_at: new Date().toISOString(),
        };
        setDraft(restored);
        await refreshCabinet('');
        setMaxStep(teamData.submitted_at ? 5 : 1);
        if (teamData.submitted_at) {
          setSubmitted({ public_number: teamData.public_number ?? '', submitted_at: teamData.submitted_at });
        }
      } catch {
        // Нет сессии — обычный сценарий: команда начинает подачу с первого шага.
      }
    })();
    return () => {
      active = false;
    };
  }, [draft, loading, refreshCabinet]);

  const requiredMaterials = useMemo(
    () => requirements.filter((item) => item.is_required && !['application_form', 'consent_pdn', 'consent_legal_rep'].includes(item.type)),
    [requirements]
  );
  const hasMinor = participants.some((participant) => {
    if (!participant.birth_date) return false;
    const closeAt = season?.application_close_at ? new Date(season.application_close_at) : new Date();
    const birth = new Date(`${participant.birth_date}T00:00:00Z`);
    const age = closeAt.getUTCFullYear() - birth.getUTCFullYear() - (closeAt < new Date(Date.UTC(closeAt.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())) ? 1 : 0);
    return age < 18;
  });

  /** Точечное изменение строки участника: поля Приложения № 1 заполняются так же. */
  function patchParticipant(index: number, patch: Partial<ParticipantRow>) {
    setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // Ошибки рядом с полем (ТЗ 08, п. 7.2): показываем сообщение у конкретного
  // поля, а не только сводкой сверху. Проверки сервера остаются главными —
  // это подсказка до отправки, чтобы не гонять пользователя по кругу.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function focusFirstError(errors: Record<string, string>) {
    const firstId = Object.keys(errors)[0];
    if (!firstId) return;
    window.setTimeout(() => document.getElementById(firstId)?.focus(), 0);
  }

  function validateStep(current: number): Record<string, string> {
    const errors: Record<string, string> = {};
    const closeAt = season?.application_close_at ? new Date(season.application_close_at) : new Date();

    const ageAt = (birthDate: string): number | null => {
      if (!birthDate) return null;
      const birth = new Date(`${birthDate}T00:00:00Z`);
      if (Number.isNaN(birth.getTime())) return null;
      return (
        closeAt.getUTCFullYear() -
        birth.getUTCFullYear() -
        (closeAt < new Date(Date.UTC(closeAt.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())) ? 1 : 0)
      );
    };
    const emailOk = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

    if (current === 0) {
      if (!teamName.trim()) errors['team-name'] = 'Укажите наименование команды.';
      if (!directionId) errors.direction = 'Выберите направление конкурса (Приложение № 2).';
      if (!lawTitle.trim()) errors['law-title'] = 'Укажите наименование законопроекта.';
      if (!annotation.trim()) errors.annotation = 'Добавьте краткую аннотацию: не более 1000 знаков.';
      if (aiUsage && !aiUsagePurpose.trim()) {
        errors['ai-purpose'] = 'Укажите цели использования систем искусственного интеллекта.';
      }
      if (isSolo && !soloApprovedAt) {
        errors['solo-approved-at'] = 'Единоличное участие допускается по согласованию с Оргкомитетом: нужна дата.';
      }
      if (!organization.trim()) {
        errors.organization = 'Укажите образовательную организацию (вуз) — начните вводить название и выберите из списка.';
      }
      if (!captainName.trim()) errors['captain-name'] = 'Укажите фамилию, имя и отчество капитана команды.';
      if (!captainBirthDate) {
        errors['captain-birth'] = 'Укажите дату рождения капитана команды.';
      } else {
        const age = ageAt(captainBirthDate);
        if (age !== null && (age < 16 || age > 35)) {
          errors['captain-birth'] = `Возраст на дату окончания приёма заявок — ${age}. Допустимо 16–35 лет (п. 4.1 Положения).`;
        }
      }
      if (!emailOk(captainEmail)) {
        errors['captain-email'] = 'Укажите корректный адрес электронной почты: по нему команда входит в личный кабинет.';
      }
      if (captainPhone.replace(/\D/g, '').length < 10) {
        errors['captain-phone'] = 'Укажите контактный телефон капитана: не менее 10 цифр.';
      }
    }

    if (current === 1) {
      participants.forEach((participant, index) => {
        if (!participant.full_name.trim()) errors[`p-name-${index}`] = 'Укажите фамилию, имя и отчество.';
        if (!participant.birth_date) {
          errors[`p-birth-${index}`] = 'Укажите дату рождения.';
        } else {
          const age = ageAt(participant.birth_date);
          if (age !== null && (age < 16 || age > 35)) {
            errors[`p-birth-${index}`] = `Возраст на дату окончания приёма заявок — ${age}. Допустимо 16–35 лет.`;
          }
        }
        if (!emailOk(participant.email)) errors[`p-email-${index}`] = 'Укажите корректный адрес электронной почты.';
        if (participant.phone.replace(/\D/g, '').length < 10) {
          errors[`p-phone-${index}`] = 'Укажите контактный телефон: не менее 10 цифр.';
        }
        if (!participant.region.trim()) {
          errors[`p-region-${index}`] = 'Укажите субъект Российской Федерации.';
        }
        if (!participant.vk_url.trim()) {
          errors[`p-vk-${index}`] = 'Укажите ссылку на страницу «ВКонтакте».';
        }
        if (!participant.organization.trim()) {
          errors[`p-organization-${index}`] = 'Укажите образовательную организацию (вуз) из списка.';
        }
        if (!participant.faculty.trim()) {
          errors[`p-faculty-${index}`] = 'Укажите факультет.';
        }
        if (!participant.course.trim()) {
          errors[`p-course-${index}`] = 'Укажите курс обучения.';
        }
        if (!participant.consent_pdn) {
          errors[`p-consent-pdn-${index}`] = 'Без согласия на обработку персональных данных участник не может быть заявлен.';
        }
        if (participant.course !== '' && (Number(participant.course) < 1 || Number(participant.course) > 6)) {
          errors[`p-course-${index}`] = 'Курс — от 1 до 6.';
        }
      });
    }

    if (current === 2) {
      mentors.forEach((mentor, index) => {
        const filled = mentor.full_name.trim() !== '' || mentor.organization.trim() !== '' || mentor.email.trim() !== '';
        if (filled && mentor.full_name.trim() === '') {
          errors[`m-name-${index}`] = 'Укажите фамилию, имя и отчество наставника.';
        }
        if (mentor.full_name.trim() !== '' && !mentor.consent_pdn) {
          errors[`m-consent-${index}`] = 'Нужно согласие наставника на обработку персональных данных.';
        }
      });
    }

    if (current === 3) {
      // Два верхних согласия обязательны (правка заказчика от 24.10.2026).
      if (!confirmRegulation) {
        errors['confirm-regulation'] = 'Подтвердите ознакомление с Положением о конкурсе.';
      }
      if (!imageLicense) {
        errors['image-license'] = 'Без согласия на использование изображения заявка не может быть отправлена.';
      }
      for (const requirement of requiredMaterials) {
        const uploaded = materials.some(
          (material) => material.type === requirement.type && material.status !== 'rejected'
        );
        if (!uploaded) errors[`upload-${requirement.type}`] = `Приложите материал: ${requirement.title}.`;
      }
      if (hasMinor) {
        const hasScan = materials.some(
          (material) => material.type === 'consent_legal_rep' && material.media_id !== null
        );
        if (!hasScan) {
          errors['upload-consent_legal_rep'] =
            'Для участников младше 18 лет нужен скан подписанного согласия законного представителя.';
        }
      }
    }

    if (current === 4) {
      if (!confirmRegulation) errors['confirm-regulation'] = 'Без подтверждения Положения заявку отправить нельзя.';
      if (!imageLicense) errors['image-license'] = 'Нужно согласие на изображение и лицензию (Приложение № 13).';
    }

    return errors;
  }

  /** Не пускает дальше, пока на шаге есть незаполненные обязательные поля. */
  function checkStep(current: number): boolean {
    const errors = validateStep(current);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) return true;
    setError('Проверьте выделенные поля: часть обязательных сведений не заполнена.');
    setDetails([]);
    focusFirstError(errors);
    return false;
  }

  function goTo(next: number) {
    setStep(next);
    setMaxStep((value) => Math.max(value, next));
    setError(null);
    setDetails([]);
    setFieldErrors({});
  }

  function markSaved() {
    setSavedAt(new Date().toISOString());
  }

  async function createApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!checkStep(0)) return;
    setError(null);
    setDetails([]);
    setFieldErrors({});
    setBusy(true);

    // Заявка уже создана (команда вернулась в мастер): правку сведений об
    // инициативе сохраняем в существующую заявку. Повторное создание упало бы
    // с отказом «команда уже зарегистрирована» по пункту 4.4.
    if (team) {
      try {
        await api.cabinetUpdateInitiative(
          {
            law_title: lawTitle.trim(),
            act_level: actLevel,
            proposed_initiator: proposedInitiator.trim() || null,
            annotation: annotation.trim(),
            ai_usage: aiUsage,
            ai_usage_purpose: aiUsage ? aiUsagePurpose.trim() : null,
            is_solo: isSolo,
            solo_approved_at: isSolo ? soloApprovedAt : null,
          },
          draft?.access_token ?? null
        );
        markSaved();
        await refreshCabinet(draft?.access_token ?? '');
        goTo(1);
      } catch (caught) {
        if (caught instanceof ApiError) {
          setError(caught.message);
          setDetails(caught.details ?? []);
        } else {
          setError('Не удалось сохранить сведения об инициативе.');
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const created = await api.createApplication(
        {
          team: {
            name: teamName.trim(),
            direction_id: Number(directionId),
            organization: organization.trim() || null,
            city: city.trim() || null,
          },
          initiative: {
            law_title: lawTitle.trim(),
            act_level: actLevel,
            proposed_initiator: proposedInitiator.trim() || null,
            annotation: annotation.trim(),
            ai_usage: aiUsage,
            ai_usage_purpose: aiUsage ? aiUsagePurpose.trim() : null,
            is_solo: isSolo,
            solo_approved_at: isSolo ? soloApprovedAt : null,
          },
          captain: {
            full_name: captainName.trim(),
            birth_date: captainBirthDate,
            category: captainCategory,
            email: captainEmail.trim(),
            phone: captainPhone.trim() || null,
          },
        },
        createIdempotencyKey()
      );

      const nextDraft: ApplicationDraftRef = {
        public_number: created.public_number,
        access_token: created.access_token,
        team_name: created.team_name,
        created_at: new Date().toISOString(),
      };
      saveDraft(nextDraft);
      setDraft(nextDraft);
      markSaved();
      await refreshCabinet(nextDraft.access_token);
      goTo(1);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось создать заявку. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveTeam() {
    if (!token) return;
    setError(null);
    setDetails([]);
    setBusy(true);
    try {
      await api.cabinetSaveTeam(
        {
          name: team?.name ?? teamName,
          direction_id: team?.direction?.id ?? Number(directionId),
          organization: team?.organization ?? (organization.trim() || null),
          city: team?.city ?? (city.trim() || null),
          participants: participants.map((participant) => ({
            id: participant.id,
            full_name: participant.full_name,
            birth_date: participant.birth_date,
            category: participant.category,
            email: participant.email,
            phone: participant.phone || null,
            role: participant.role,
            consent_pdn: participant.consent_pdn,
            consent_distribution: participant.consent_distribution,
            consent_legal_representative: participant.consent_legal_representative,
            organization: participant.organization || null,
            citizenship: participant.citizenship || null,
            region: participant.region || null,
            settlement: participant.settlement || null,
            vk_url: participant.vk_url || null,
            competencies: participant.competencies || null,
            personal_contribution: participant.personal_contribution || null,
            faculty: participant.faculty || null,
            course: participant.course === '' ? null : Number(participant.course),
            study_program: participant.study_program || null,
          })),
          mentors: mentors
            .filter((mentor) => mentor.full_name.trim() !== '')
            .map((mentor) => ({
              full_name: mentor.full_name,
              organization: mentor.organization || null,
              position: mentor.position || null,
              degree: mentor.academic_degree || null,
              academic_degree: mentor.academic_degree || null,
              academic_title: mentor.academic_title || null,
              email: mentor.email || null,
              phone: mentor.phone || null,
              consent_pdn: mentor.consent_pdn,
            })),
        },
        token
      );
      await refreshCabinet(token);
      markSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось сохранить состав команды.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadMaterial(type: string, file: File) {
    if (!token) return;
    setError(null);
    setUploadingType(type);
    try {
      const form = new FormData();
      form.append('type', type);
      form.append('file', file);
      await api.cabinetUploadMaterial(form, token);
      const materialsData = await api.cabinetMaterials(token);
      setMaterials(materialsData);
      markSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить файл.');
    } finally {
      setUploadingType(null);
    }
  }

  /**
   * Прикрепление материала ссылкой: видеоролик первого этапа публикуется во
   * «ВКонтакте», файлом он не передаётся (тип video_link — только ссылка).
   * Презентацию и иной материал можно приложить и файлом, и ссылкой.
   */
  async function attachLink(type: string, url: string) {
    if (!token) return;
    const value = url.trim();
    if (value === '') {
      setFieldErrors((current) => ({ ...current, [`link-${type}`]: 'Вставьте ссылку на публикацию.' }));
      return;
    }
    setError(null);
    setUploadingType(type);
    try {
      const form = new FormData();
      form.append('type', type);
      form.append('external_url', value);
      await api.cabinetUploadMaterial(form, token);
      const materialsData = await api.cabinetMaterials(token);
      setMaterials(materialsData);
      setLinkValues((current) => ({ ...current, [type]: '' }));
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[`link-${type}`];
        return next;
      });
      markSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось прикрепить ссылку.');
    } finally {
      setUploadingType(null);
    }
  }

  async function submitApplication() {
    if (!token) return;
    setError(null);
    setDetails([]);
    setBusy(true);
    try {
      const response = await api.cabinetSubmit(
        {
          confirm_regulation: confirmRegulation,
          image_license: imageLicense,
          marketing_consent: marketingConsent,
          distribution: participants
            .filter((participant) => participant.id !== null)
            .map((participant) => ({
              participant_id: participant.id as number,
              categories: distribution[participant.id as number] ?? {},
              conditions: distributionConditions.trim() || null,
            })),
        },
        token
      );
      setSubmitted({ public_number: response.public_number, submitted_at: response.submitted_at });
      clearDraft();
      setDraft(null);
      goTo(4);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось отправить заявку.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <p role="status">Загружаем условия конкурса…</p>
      </main>
    );
  }

  const applicationClosed = season ? !season.is_application_open : false;
  const applicationNotStarted = season?.application_not_started === true;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-5 py-8 sm:px-6 sm:py-12">
      {/* Шапка мастера: юбилейный логотип слева, «Лидеры права» и подпись
          «Мастер подачи заявок» справа (правка заказчика от 24.10.2026). */}
      <header className="flex flex-wrap items-center gap-5 border-b border-border pb-6 sm:gap-7">
        <img
          src="/assets/logo-ten-600.png"
          alt="Юбилейный знак: 10 сезонов конкурса «Лидеры права»"
          className="h-20 w-auto sm:h-24"
          width={600}
          height={432}
        />
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl font-extrabold uppercase tracking-[-0.02em] sm:text-4xl">
            Лидеры права
          </span>
          <span className="text-sm text-muted sm:text-base">Мастер подачи заявок</span>
        </div>
        {savedAt ? (
          <span className="ml-auto text-sm text-muted">Черновик сохранён, {formatSavedAt(savedAt)}</span>
        ) : draft ? (
          <span className="ml-auto text-sm text-muted">Заявка {draft.public_number}</span>
        ) : null}
      </header>

      {season ? (
        <p className="text-sm text-muted">
          Приём заявок: {formatMoscowHuman(season.application_open_at)} — {formatMoscowHuman(season.application_close_at)}
        </p>
      ) : null}

      {applicationClosed && !submitted ? (
        applicationNotStarted ? (
          <Alert tone="info" title="Приём заявок ещё не открыт">
            Приём заявок откроется {formatMoscowHuman(season?.application_open_at)}. Мастер заполнения можно открыть
            заранее: черновик сохраняется в браузере, а отправить заявку получится с начала приёма. Условия участия —
            в{' '}
            <Link to="/about/regulations" className="text-accent underline underline-offset-2">
              Положении о конкурсе
            </Link>
            .
          </Alert>
        ) : (
          <Alert tone="warning" title="Приём заявок закрыт">
            Срок приёма заявок истёк {formatMoscowHuman(season?.application_close_at)}. Напишите в Оргкомитет, если
            нужна помощь: Тажибов Арслан Азизович, 8 (966) 789-76-05, lidery.prava@mail.ru.
          </Alert>
        )
      ) : null}

      {error ? (
        <Alert tone="danger" title="Проверьте заполнение">
          {error}
        </Alert>
      ) : null}
      {details.length > 0 ? <Alert tone="warning" title="Что нужно исправить" details={details} /> : null}

      {submitted ? (
        <SectionCard title="Заявка отправлена" description="Команда получила статус «на технической проверке».">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Номер заявки</dt>
              <dd className="font-mono">{submitted.public_number}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Отправлена</dt>
              <dd>{formatMoscowHuman(submitted.submitted_at)}</dd>
            </div>
          </dl>

          {/* Ссылка доступа показывается на экране сразу после отправки
              (ТЗ 06, п. 1.4): почта не отправляется, поэтому это единственный
              способ передать команде вход в кабинет в момент подачи. */}
          {directAccessUrl ? (
            <div className="mt-5 border border-border-strong p-4">
              <p className="mono-label text-muted">Ссылка для входа в личный кабинет</p>
              <p className="mt-2 break-all font-mono text-sm">{directAccessUrl}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(directAccessUrl).then(
                      () => setLinkCopied(true),
                      () => setLinkCopied(false)
                    );
                  }}
                >
                  {linkCopied ? 'Скопировано' : 'Скопировать ссылку'}
                </Button>
                <Link className="text-sm underline" to={directAccessPath ?? '/cabinet/access'} target="_blank" rel="noreferrer">
                  Открыть кабинет
                </Link>
              </div>
              <p className="mt-3 text-sm text-muted">
                Сохраните ссылку: она открывает кабинет без пароля. Если ссылка потеряется, вход возможен по номеру
                заявки и адресу электронной почты капитана.
              </p>
            </div>
          ) : null}
        </SectionCard>
      ) : (
        <>
          <StepProgress steps={MASTER_STEPS} currentIndex={step} onSelect={(index) => (index <= maxStep ? goTo(index) : undefined)} />

          {step === 0 ? (
            <SectionCard title="Команда и законотворческая инициатива" description="Сведения по Приложению № 1 к Положению.">
              <form className="flex flex-col gap-6" onSubmit={createApplication} noValidate>
                {team ? (
                  <Alert tone="info" title="Заявка уже создана">
                    Название команды, направление и город меняются в кабинете, раздел «Команда». Здесь можно
                    исправить сведения об инициативе и продолжить заполнение.
                  </Alert>
                ) : null}
                <div className="grid gap-5 md:grid-cols-2">
                  <TextField id="team-name" error={fieldErrors['team-name']} label="Наименование команды" required disabled={Boolean(team)} value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={200} />
                  <SelectField
                    id="direction" error={fieldErrors['direction']}
                    label="Направление конкурса"
                    required
                    value={directionId}
                    onChange={(e) => setDirectionId(e.target.value)}
                    placeholder="Выберите направление"
                    disabled={Boolean(team)}
                    options={directions.map((direction) => ({ value: direction.id, title: direction.title }))}
                  />
                  <UniversityField id="organization" error={fieldErrors.organization} label="Образовательная организация или место работы" required disabled={Boolean(team)} value={organization} onChange={setOrganization} hint="Начните вводить название вуза и выберите из списка; можно ввести и вручную." />
                  <TextField id="city" label="Город" disabled={Boolean(team)} value={city} onChange={(e) => setCity(e.target.value)} maxLength={120} />
                </div>

                <h3 className="text-h3 font-semibold">Законопроект</h3>
                <div className="grid gap-5 md:grid-cols-2">
                  <TextField id="law-title" error={fieldErrors['law-title']} label="Наименование законопроекта" required value={lawTitle} onChange={(e) => setLawTitle(e.target.value)} maxLength={300} />
                  <SelectField
                    id="act-level"
                    label="Уровень акта"
                    required
                    value={actLevel}
                    onChange={(e) => setActLevel(e.target.value as ActLevel)}
                    options={ACT_LEVELS.map((level) => ({ value: level.value, title: level.title }))}
                  />
                  <TextField id="proposed-initiator" label="Предполагаемый субъект права законодательной инициативы" value={proposedInitiator} onChange={(e) => setProposedInitiator(e.target.value)} maxLength={300} />
                </div>
                <TextAreaField
                  id="annotation" error={fieldErrors['annotation']}
                  label="Краткая аннотация инициативы"
                  required
                  value={annotation}
                  onChange={(e) => setAnnotation(e.target.value)}
                  maxLength={1000}
                  hint={`Не более 1000 знаков. Введено: ${annotation.length}.`}
                />
                <CheckboxField id="ai-usage" label="При разработке использовались системы искусственного интеллекта" checked={aiUsage} onChange={setAiUsage} />
                {aiUsage ? (
                  <TextField id="ai-purpose" error={fieldErrors['ai-purpose']} label="Цели использования систем искусственного интеллекта" required value={aiUsagePurpose} onChange={(e) => setAiUsagePurpose(e.target.value)} maxLength={500} />
                ) : null}
                <CheckboxField
                  id="is-solo"
                  label="Единоличное участие"
                  checked={isSolo}
                  onChange={setIsSolo}
                  hint="Допускается только по письменному согласованию с Оргкомитетом до окончания срока приёма заявок (п. 4.3 Положения)."
                />
                {isSolo ? (
                  <TextField id="solo-approved-at" error={fieldErrors['solo-approved-at']} label="Дата согласования с Оргкомитетом" type="date" required value={soloApprovedAt} onChange={(e) => setSoloApprovedAt(e.target.value)} />
                ) : null}

                <h3 className="text-h3 font-semibold">Капитан команды</h3>
                <div className="grid gap-5 md:grid-cols-2">
                  <TextField id="captain-name" error={fieldErrors['captain-name']} label="Фамилия, имя, отчество" required value={captainName} onChange={(e) => setCaptainName(e.target.value)} maxLength={200} />
                  <TextField id="captain-birth" error={fieldErrors['captain-birth']} label="Дата рождения" type="date" required value={captainBirthDate} onChange={(e) => setCaptainBirthDate(e.target.value)} hint="Участие возможно с 16 до 35 лет включительно (п. 4.1 Положения)." />
                  <SelectField
                    id="captain-category"
                    label="Категория участника"
                    required
                    value={captainCategory}
                    onChange={(e) => setCaptainCategory(e.target.value as ParticipantCategory)}
                    options={PARTICIPANT_CATEGORIES.map((category) => ({ value: category.value, title: category.title }))}
                  />
                  <TextField id="captain-email" error={fieldErrors['captain-email']} label="Адрес электронной почты" type="email" required value={captainEmail} onChange={(e) => setCaptainEmail(e.target.value)} hint="По этой почте команда входит в личный кабинет." />
                  <TextField id="captain-phone" error={fieldErrors['captain-phone']} label="Контактный телефон" type="tel" required value={captainPhone} onChange={(e) => setCaptainPhone(e.target.value)} maxLength={32} hint="Обязательное поле: по нему Оргкомитет связывается с капитаном." />
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" loading={busy} disabled={applicationClosed}>
                    Создать заявку и продолжить
                  </Button>
                  <p className="text-sm text-muted">После этого шага система выдаст номер заявки и ссылку доступа.</p>
                </div>
              </form>
            </SectionCard>
          ) : null}

          {step === 1 ? (
            <>
            <SectionCard
              title="Участники"
              description="От 2 до 4 человек; первым указан капитан команды. Один участник может входить только в одну команду сезона (п. 4.3–4.4 Положения)."
              footer={
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => {
                      setParticipants((rows) => [...rows, { ...EMPTY_PARTICIPANT }]);
                    }}
                    variant="secondary"
                  >
                    Добавить участника
                  </Button>
                  <Button
                    loading={busy}
                    onClick={() => {
                      if (!checkStep(1)) return;
                      void saveTeam().then(() => goTo(2));
                    }}
                  >
                    Сохранить и продолжить
                  </Button>
                </div>
              }
            >
              <div className="flex flex-col gap-8">
                {participants.map((participant, index) => {
                  // Нумерация участников без капитана: капитан идёт первым и
                  // отдельно, дальше «Участник 1», «Участник 2» и так далее —
                  // иначе после капитана список начинался с «Участник 2».
                  const memberNumber = participants
                    .slice(0, index + 1)
                    .filter((row) => row.role !== 'captain').length;
                  return (
                  <fieldset key={`participant-${participant.id ?? index}`} className="flex flex-col gap-4 border border-border p-4">
                    <legend className="mono-label px-2 text-muted">
                      {participant.role === 'captain' ? 'Капитан команды' : `Участник ${memberNumber}`}
                    </legend>
                    {participant.role === 'captain' ? (
                      <p className="text-sm text-muted">
                        Данные капитана заполнены на первом шаге. Проверьте их и при необходимости исправьте: капитан
                        получает доступ в личный кабинет и подаёт апелляции.
                      </p>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField id={`p-name-${index}`} error={fieldErrors[`p-name-${index}`]} label="Фамилия, имя, отчество" required value={participant.full_name} onChange={(e) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, full_name: e.target.value } : row)))} />
                      <TextField id={`p-birth-${index}`} error={fieldErrors[`p-birth-${index}`]} label="Дата рождения" type="date" required value={participant.birth_date} onChange={(e) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, birth_date: e.target.value } : row)))} />
                      <SelectField
                        id={`p-category-${index}`}
                        label="Категория участника"
                        required
                        value={participant.category}
                        onChange={(e) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, category: e.target.value as ParticipantCategory } : row)))}
                        options={PARTICIPANT_CATEGORIES.map((category) => ({ value: category.value, title: category.title }))}
                      />
                      <TextField id={`p-email-${index}`} error={fieldErrors[`p-email-${index}`]} label="Адрес электронной почты" type="email" required value={participant.email} onChange={(e) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, email: e.target.value } : row)))} />
                      <TextField id={`p-phone-${index}`} error={fieldErrors[`p-phone-${index}`]} label="Контактный телефон" type="tel" required value={participant.phone} onChange={(e) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, phone: e.target.value } : row)))} />
                      <TextField id={`p-citizenship-${index}`} label="Гражданство" value={participant.citizenship} onChange={(e) => patchParticipant(index, { citizenship: e.target.value })} maxLength={120} />
                      <TextField id={`p-region-${index}`} error={fieldErrors[`p-region-${index}`]} label="Субъект Российской Федерации" required value={participant.region} onChange={(e) => patchParticipant(index, { region: e.target.value })} maxLength={200} />
                      <TextField id={`p-settlement-${index}`} label="Населённый пункт" value={participant.settlement} onChange={(e) => patchParticipant(index, { settlement: e.target.value })} maxLength={200} />
                      <TextField id={`p-vk-${index}`} error={fieldErrors[`p-vk-${index}`]} label="Ссылка на страницу «ВКонтакте»" required value={participant.vk_url} onChange={(e) => patchParticipant(index, { vk_url: e.target.value })} maxLength={300} placeholder="https://vk.com/…" />
                      <TextField id={`p-education-org-${index}`} label="Образовательная организация (место работы)" value={participant.organization} onChange={(e) => patchParticipant(index, { organization: e.target.value })} maxLength={300} />
                      <TextField id={`p-faculty-${index}`} error={fieldErrors[`p-faculty-${index}`]} label="Факультет" required value={participant.faculty} onChange={(e) => patchParticipant(index, { faculty: e.target.value })} maxLength={300} />
                      <TextField id={`p-course-${index}`} error={fieldErrors[`p-course-${index}`]} label="Курс" type="number" min={1} max={6} required value={participant.course} onChange={(e) => patchParticipant(index, { course: e.target.value })} hint="От 1 до 6." />
                      <TextField id={`p-program-${index}`} label="Направление подготовки (должность)" value={participant.study_program} onChange={(e) => patchParticipant(index, { study_program: e.target.value })} maxLength={300} />
                    </div>
                    <TextAreaField
                      id={`p-competencies-${index}`}
                      label="Краткие сведения о компетенциях, опыте, публикациях, достижениях"
                      value={participant.competencies}
                      onChange={(e) => patchParticipant(index, { competencies: e.target.value })}
                      maxLength={800}
                      hint={`Не более 800 знаков. Введено: ${participant.competencies.length}.`}
                    />
                    <TextAreaField
                      id={`p-contribution-${index}`}
                      label="Личный вклад в разработку инициативы"
                      value={participant.personal_contribution}
                      onChange={(e) => patchParticipant(index, { personal_contribution: e.target.value })}
                      maxLength={1000}
                    />
                    <CheckboxField
                      id={`p-consent-pdn-${index}`} error={fieldErrors[`p-consent-pdn-${index}`]}
                      label="Согласие на обработку персональных данных (Приложения № 10–12)"
                      checked={participant.consent_pdn}
                      onChange={(value) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, consent_pdn: value } : row)))}
                    />
                    <CheckboxField
                      id={`p-consent-legal-${index}`}
                      label="Согласие законного представителя (для участников младше 18 лет, Приложение № 11)"
                      checked={participant.consent_legal_representative}
                      onChange={(value) => setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, consent_legal_representative: value } : row)))}
                    />
                    {participant.role !== 'captain' ? (
                      <Button
                        variant="quiet"
                        onClick={() => setParticipants((rows) => rows.filter((_, i) => i !== index))}
                      >
                        Удалить участника
                      </Button>
                    ) : null}
                  </fieldset>
                  );
                })}
              </div>
            </SectionCard>
              <SectionCard
                title="Наставники"
                description="Не более двух наставников. Наставник не является членом команды и не выступает на этапах (п. 4.9 Положения)."
                footer={
                  <Button variant="secondary" onClick={() => setMentors((rows) => [...rows, { ...EMPTY_MENTOR }])} disabled={mentors.length >= 2}>
                    Добавить наставника
                  </Button>
                }
              >
                <div className="flex flex-col gap-8">
                  {mentors.map((mentor, index) => (
                    <fieldset key={`mentor-${index}`} className="flex flex-col gap-4 border border-border p-4">
                      <legend className="mono-label px-2 text-muted">Наставник {index + 1}</legend>
                      <div className="grid gap-4 md:grid-cols-2">
                        <TextField id={`m-name-${index}`} error={fieldErrors[`m-name-${index}`]} label="Фамилия, имя, отчество" value={mentor.full_name} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, full_name: e.target.value } : row)))} />
                        <TextField id={`m-org-${index}`} label="Место работы" value={mentor.organization} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, organization: e.target.value } : row)))} />
                        <TextField id={`m-position-${index}`} label="Должность" value={mentor.position} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, position: e.target.value } : row)))} />
                        <TextField id={`m-degree-${index}`} label="Учёная степень" value={mentor.academic_degree} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, academic_degree: e.target.value } : row)))} />
                        <TextField id={`m-title-${index}`} label="Учёное звание" value={mentor.academic_title} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, academic_title: e.target.value } : row)))} />
                        <TextField id={`m-email-${index}`} label="Адрес электронной почты" type="email" value={mentor.email} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, email: e.target.value } : row)))} />
                        <TextField id={`m-phone-${index}`} label="Контактный телефон" type="tel" value={mentor.phone} onChange={(e) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, phone: e.target.value } : row)))} />
                      </div>
                      <CheckboxField
                        id={`m-consent-${index}`} error={fieldErrors[`m-consent-${index}`]}
                        label="Согласие наставника на обработку персональных данных"
                        checked={mentor.consent_pdn}
                        onChange={(value) => setMentors((rows) => rows.map((row, i) => (i === index ? { ...row, consent_pdn: value } : row)))}
                      />
                      {mentors.length > 1 ? (
                        <Button variant="quiet" onClick={() => setMentors((rows) => rows.filter((_, i) => i !== index))}>
                          Удалить наставника
                        </Button>
                      ) : null}
                    </fieldset>
                  ))}
                </div>
              </SectionCard>
            </>
          ) : null}

          {step === 2 ? (
            <SectionCard
              title="Конкурсные материалы"
              description="Состав комплекта ведёт Оргкомитет. Форматы и шаблон имени файла — по Приложению № 6."
              footer={
                <Button
                  onClick={() => {
                    if (!checkStep(2)) return;
                    void saveTeam().then(() => goTo(3));
                  }}
                  loading={busy}
                >
                  Сохранить и продолжить
                </Button>
              }
            >
              <ul className="flex flex-col gap-5">
                {requirements
                  .filter((item) => item.type !== 'application_form' && item.type !== 'consent_pdn')
                  .map((requirement) => {
                    const uploaded = materials.filter((material) => material.type === requirement.type);
                    const conditional = requirement.type === 'consent_legal_rep';
                    const isRequired = requirement.is_required || (conditional && hasMinor);
                    const linkOnly = (LINK_ONLY_MATERIAL_TYPES as readonly string[]).includes(requirement.type);
                    const linkAllowed = (LINK_ALLOWED_MATERIAL_TYPES as readonly string[]).includes(requirement.type);
                    return (
                      <li key={requirement.type} className="flex flex-col gap-3 border-b border-border pb-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-h3 font-semibold">{requirement.title}</h3>
                          <StatusBadge status={uploaded.length > 0 ? 'allowed' : isRequired ? 'tech_rejected' : 'draft'} title={uploaded.length > 0 ? 'загружено' : isRequired ? 'обязательно' : 'не обязательно'} />
                        </div>
                        {requirement.description ? <p className="max-w-measure text-sm text-muted">{requirement.description}</p> : null}
                        <p className="text-sm text-muted">
                          Срок: {formatMoscowHuman(requirement.due_at)}
                          {requirement.name_template ? ` · имя файла: ${requirement.name_template}` : ''}
                          {requirement.allowed_extensions.length > 0 ? ` · форматы: ${requirement.allowed_extensions.join(', ')}` : ''}
                        </p>
                        {uploaded.map((material) => (
                          <p key={material.id} className="text-sm">
                            {material.file_name ?? material.external_url} · {formatFileSize(material.file_size)} ·{' '}
                            {MATERIAL_STATUS_TITLES[material.status] ?? material.status}
                            {material.reviewer_comment ? ` · замечание: ${material.reviewer_comment}` : ''}
                          </p>
                        ))}
                        <div className="flex flex-col gap-3">
                          {linkOnly || linkAllowed ? (
                            <div>
                              <label className="text-sm font-medium text-fg" htmlFor={`link-${requirement.type}`}>
                                Ссылка на публикацию
                              </label>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <input
                                  id={`link-${requirement.type}`}
                                  type="url"
                                  inputMode="url"
                                  placeholder="https://vk.com/…"
                                  className="min-h-[44px] w-full max-w-xl border border-border-strong bg-raised px-3 py-2 text-body text-fg"
                                  disabled={uploadingType !== null || applicationClosed}
                                  value={linkValues[requirement.type] ?? ''}
                                  onChange={(event) =>
                                    setLinkValues((current) => ({ ...current, [requirement.type]: event.target.value }))
                                  }
                                />
                                <Button
                                  variant="secondary"
                                  loading={uploadingType === requirement.type}
                                  disabled={applicationClosed}
                                  onClick={() => void attachLink(requirement.type, linkValues[requirement.type] ?? '')}
                                >
                                  Прикрепить ссылку
                                </Button>
                              </div>
                              {fieldErrors[`link-${requirement.type}`] ? (
                                <p role="alert" className="mt-2 text-sm text-danger">
                                  {fieldErrors[`link-${requirement.type}`]}
                                </p>
                              ) : null}
                              {linkOnly ? (
                                <p className="mt-2 text-sm text-muted">
                                  Этот материал передаётся ссылкой: файл загружать не нужно.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {linkOnly ? null : (
                            <div>
                              <label className="text-sm font-medium text-fg" htmlFor={`upload-${requirement.type}`}>
                                Загрузить файл
                              </label>
                              <input
                                id={`upload-${requirement.type}`}
                                type="file"
                                className="mt-2 block w-full text-sm"
                                disabled={uploadingType !== null || applicationClosed}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) void uploadMaterial(requirement.type, file);
                                }}
                              />
                            </div>
                          )}
                          {uploadingType === requirement.type ? (
                            <p role="status" className="mt-2 text-sm text-muted">
                              Загружаем файл…
                            </p>
                          ) : null}
                          {fieldErrors[`upload-${requirement.type}`] ? (
                            <p
                              id={`upload-${requirement.type}-error`}
                              role="alert"
                              className="mt-2 text-sm text-danger"
                            >
                              {fieldErrors[`upload-${requirement.type}`]}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
              </ul>
              {requiredMaterials.length > 0 ? (
                <p className="mt-5 text-sm text-muted">
                  Обязательных материалов: {pluralize(requiredMaterials.length, ['комплект', 'комплекта', 'комплектов'])}. Заявку нельзя
                  отправить, пока они не загружены.
                </p>
              ) : null}
            </SectionCard>
          ) : null}

          {step === 3 ? (
            <SectionCard
              title="Согласия"
              description="Согласие на обработку персональных данных и согласие на распространение оформляются отдельно друг от друга (п. 14.3 Положения). Фиксируются дата, время, сетевой адрес и версия текста согласия."
              footer={
                <Button
                  onClick={() => {
                    if (!checkStep(3)) return;
                    goTo(4);
                  }}
                  loading={busy}
                >
                  Перейти к проверке
                </Button>
              }
            >
              <div className="flex flex-col gap-6">
                <CheckboxField
                  id="confirm-regulation" error={fieldErrors['confirm-regulation']}
                  label="Подтверждаю ознакомление с Положением о Конкурсе и принимаю его условия, а также подтверждаю достоверность сведений и самостоятельность творческой работы команды"
                  checked={confirmRegulation}
                  onChange={setConfirmRegulation}
                />
                <CheckboxField
                  id="image-license" error={fieldErrors['image-license']}
                  label="Даю согласие на использование изображения и предоставляю право использования конкурсных материалов (Приложение № 13)"
                  checked={imageLicense}
                  onChange={setImageLicense}
                />
                {mailingConsentAvailable ? (
                  <CheckboxField
                    id="marketing-consent"
                    label="Согласен получать информационные и новостные сообщения о конкурсе. Согласие необязательное: отказ не влияет на участие, отказаться можно в любой момент письмом в Оргкомитет"
                    checked={marketingConsent}
                    onChange={setMarketingConsent}
                  />
                ) : null}

                <div className="flex flex-col gap-4">
                  <h3 className="text-h3 font-semibold">Согласие на распространение персональных данных (Приложение № 12)</h3>
                  <p className="max-w-measure text-sm text-muted">
                    Отметьте по каждой строке, разрешаете вы публикацию этих сведений или нет. Если ничего не отмечено, карточка
                    инициативы в архиве будет опубликована обезличенно.
                  </p>
                  {participants
                    .filter((participant) => participant.id !== null)
                    .map((participant) => (
                      <fieldset key={`distribution-${participant.id}`} className="border border-border p-4">
                        <legend className="mono-label px-2 text-muted">{participant.full_name}</legend>
                        <div className="flex flex-col gap-3">
                          {DISTRIBUTION_CATEGORIES.map((category) => (
                            <CheckboxField
                              key={category.code}
                              id={`distribution-${participant.id}-${category.code}`}
                              label={category.title}
                              checked={distribution[participant.id as number]?.[category.code] === true}
                              onChange={(value) =>
                                setDistribution((current) => ({
                                  ...current,
                                  [participant.id as number]: { ...current[participant.id as number], [category.code]: value },
                                }))
                              }
                            />
                          ))}
                        </div>
                      </fieldset>
                    ))}
                  <TextField
                    id="distribution-conditions"
                    label="Условия и запреты (по желанию)"
                    value={distributionConditions}
                    onChange={(e) => setDistributionConditions(e.target.value)}
                    maxLength={1000}
                    hint="Например: «не указывать населённый пункт»."
                  />
                </div>
              </div>
            </SectionCard>
          ) : null}

          {step === 4 ? (
            <SectionCard title="Проверка и отправка" description="После отправки заявка получает статус «на технической проверке».">
              {!team ? (
                <p className="text-sm text-muted">Данные заявки загружаются…</p>
              ) : (
                <div className="flex flex-col gap-5 text-sm">
                  <dl className="grid gap-3 md:grid-cols-2">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Номер заявки</dt>
                      <dd className="font-mono">{team.public_number ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Направление</dt>
                      <dd>{team.direction?.title ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Участников</dt>
                      <dd>{pluralize(team.participants.length, ['участник', 'участника', 'участников'])}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Наставников</dt>
                      <dd>{pluralize(team.mentors.length, ['наставник', 'наставника', 'наставников'])}</dd>
                    </div>
                  </dl>

                  <div>
                    <h3 className="text-h3 font-semibold">Материалы</h3>
                    <ul className="mt-2 list-disc pl-5">
                      {materials.length === 0 ? <li>ни одного материала не загружено</li> : null}
                      {materials.map((material) => (
                        <li key={material.id}>
                          {material.type_title}: {material.file_name ?? material.external_url}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-h3 font-semibold">Согласия</h3>
                    <ul className="mt-2 list-disc pl-5">
                      <li>Согласие на обработку персональных данных участников: {participants.every((p) => p.consent_pdn) ? 'да' : 'нет'}</li>
                      <li>Ознакомление с Положением: {confirmRegulation ? 'да' : 'нет'}</li>
                      <li>Согласие на изображение и лицензия: {imageLicense ? 'да' : 'нет'}</li>
                      {mailingConsentAvailable ? (
                        <li>Информационные сообщения о конкурсе: {marketingConsent ? 'да' : 'нет'}</li>
                      ) : null}
                    </ul>
                  </div>

                  <Button loading={busy} onClick={() => void submitApplication()} disabled={applicationClosed}>
                    Отправить заявку
                  </Button>
                  <p className="text-muted">
                    Отправляя заявку, команда подтверждает достоверность сведений. Датой подачи считается дата поступления заявки
                    (п. 7.3 Положения).
                  </p>
                </div>
              )}
            </SectionCard>
          ) : null}
        </>
      )}
    </main>
  );
}
