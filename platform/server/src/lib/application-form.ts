import { query } from '../db.js';
import { formatMoscowDateHuman, formatMoscowHuman } from './moscow-time.js';
import { buildDocx, paragraph, table } from './docx.js';

// Заполненный бланк заявки по Приложению № 1.
//
// Приложение № 1 в редакции 04.10.2026: «Заявка формируется системой в
// электронном виде и доступна участнику для скачивания в личном кабинете;
// представление отдельного файла не требуется». Бланк собирается из данных
// заявки, поэтому скачивать и заполнять вручную ничего не нужно.

const NOT_SET = '—';

const ACT_LEVEL_TITLES: Record<string, string> = {
  federal_constitutional: 'Федеральный конституционный закон',
  federal: 'Федеральный закон',
  regional: 'Закон субъекта Российской Федерации',
};

const CATEGORY_TITLES: Record<string, string> = {
  student: 'Студент (бакалавриат, специалитет, СПО)',
  magistrant: 'Магистрант',
  aspirant: 'Аспирант (адъюнкт)',
  young_specialist: 'Молодой специалист',
  mo_leader: 'Лидер молодёжной организации',
};

interface ApplicationFormData {
  application: Record<string, unknown>;
  team: Record<string, unknown>;
  participants: Array<Record<string, unknown>>;
  mentors: Array<Record<string, unknown>>;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return NOT_SET;
  const stringValue = String(value).trim();
  return stringValue === '' ? NOT_SET : stringValue;
}

/** Загружает всё, что попадает в бланк заявки. */
export async function loadApplicationFormData(teamId: number): Promise<ApplicationFormData | null> {
  const applicationResult = await query(
    `SELECT a.public_number, a.law_title, a.act_level, a.proposed_initiator, a.annotation,
            a.ai_usage, a.ai_usage_purpose, a.is_solo, a.solo_approved_at,
            a.submitted_at, a.created_at, a.tech_status,
            t.name AS team_name, t.organization, t.city,
            d.title AS direction_title,
            s.title AS season_title, s.year AS season_year
       FROM applications a
       JOIN teams t ON t.id = a.team_id
       JOIN seasons s ON s.id = a.season_id
       LEFT JOIN directions d ON d.id = t.direction_id
      WHERE a.team_id = $1
      ORDER BY a.id DESC
      LIMIT 1`,
    [teamId]
  );
  const application = applicationResult.rows[0];
  if (!application) return null;

  const participants = await query(
    `SELECT full_name, role, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
            citizenship, region, settlement, category,
            organization, faculty, course, study_program, position, education,
            email, phone, vk_url, competencies, personal_contribution, is_minor
       FROM participants
      WHERE team_id = $1
      ORDER BY CASE WHEN role = 'captain' THEN 0 ELSE 1 END, id`,
    [teamId]
  );

  const mentors = await query(
    `SELECT full_name, organization, position,
            COALESCE(academic_degree, degree) AS academic_degree, academic_title,
            email, phone
       FROM mentors
      WHERE team_id = $1
      ORDER BY id`,
    [teamId]
  );

  return {
    application,
    team: {
      name: application.team_name,
      organization: application.organization,
      city: application.city,
      direction_title: application.direction_title,
    },
    participants: participants.rows,
    mentors: mentors.rows,
  };
}

/** Собирает бланк заявки по Приложению № 1. */
export function buildApplicationFormDocx(data: ApplicationFormData, now: Date = new Date()): Buffer {
  const { application, team, participants, mentors } = data;
  const blocks: string[] = [];

  blocks.push(
    paragraph('Приложение № 1', { size: 24, align: 'right', spaceAfter: 0 }),
    paragraph(
      'к Положению о Десятом ежегодном федеральном научно-образовательном конкурсе «Лидеры права – 2027»',
      { size: 20, align: 'right', spaceAfter: 240 }
    ),
    paragraph('ФОРМА ЗАЯВКИ НА УЧАСТИЕ В КОНКУРСЕ', { bold: true, size: 28, align: 'center', spaceAfter: 120 }),
    paragraph(
      'Заявка сформирована системой в электронном виде; представление отдельного файла не требуется (Приложение № 1 в редакции от 4 октября 2026 года).',
      { italic: true, size: 20, align: 'center', spaceAfter: 240 }
    ),
    paragraph(
      `Заявка № ${text(application.public_number)} · ${text(application.season_title)}`,
      { size: 22, spaceAfter: 240 }
    )
  );

  // ── 1. Команда и инициатива ────────────────────────────────────────────────
  blocks.push(
    paragraph('1. Сведения о команде и законотворческой инициативе', { bold: true, size: 24, spaceAfter: 120 }),
    table(
      [
        ['Наименование команды', text(team.name)],
        ['Направление Конкурса (Приложение № 2)', text(team.direction_title)],
        [
          'Образовательная организация или место работы',
          [text(team.organization), text(team.city)].filter((value) => value !== NOT_SET).join(', ') || NOT_SET,
        ],
        ['Наименование законопроекта', text(application.law_title)],
        ['Уровень акта', ACT_LEVEL_TITLES[String(application.act_level)] ?? text(application.act_level)],
        ['Предполагаемый субъект права законодательной инициативы', text(application.proposed_initiator)],
        ['Краткая аннотация инициативы', text(application.annotation)],
        [
          'Единоличное участие',
          application.is_solo === true
            ? `да, согласовано с Оргкомитетом ${formatMoscowDateHuman(application.solo_approved_at as string) ?? NOT_SET}`
            : 'нет',
        ],
        [
          'Использование систем искусственного интеллекта',
          application.ai_usage === true ? `да, цели: ${text(application.ai_usage_purpose)}` : 'нет',
        ],
      ],
      { header: ['Показатель', 'Сведения'], labelBold: true }
    )
  );

  // ── 2. Участники ───────────────────────────────────────────────────────────
  blocks.push(
    paragraph('2. Сведения об участниках', { bold: true, size: 24, spaceAfter: 120 }),
    paragraph('Первым указан капитан команды (п. 4.3 Положения).', { size: 20, spaceAfter: 120 })
  );

  participants.forEach((participant, index) => {
    const isCaptain = participant.role === 'captain';
    blocks.push(
      paragraph(
        `Участник № ${index + 1}${isCaptain ? ' — капитан команды' : ''}`,
        { bold: true, size: 22, spaceAfter: 80 }
      ),
      table([
        ['Фамилия, имя, отчество (при наличии)', text(participant.full_name)],
        ['Роль в команде', isCaptain ? 'капитан' : 'участник'],
        ['Дата рождения', formatMoscowDateHuman(participant.birth_date as string) ?? NOT_SET],
        ['Гражданство', text(participant.citizenship)],
        [
          'Субъект Российской Федерации, населённый пункт',
          [participant.region, participant.settlement]
            .map(text)
            .filter((value) => value !== NOT_SET)
            .join(', ') || NOT_SET,
        ],
        ['Категория участника (п. 4.1 Положения)', CATEGORY_TITLES[String(participant.category)] ?? text(participant.category)],
        ['Образовательная организация (место работы)', text(participant.organization)],
        ['Факультет', text(participant.faculty)],
        ['Курс', text(participant.course)],
        ['Направление подготовки (должность)', text(participant.study_program) || text(participant.position)],
        ['Контактный телефон', text(participant.phone)],
        ['Адрес электронной почты', text(participant.email)],
        ['Ссылка на страницу «ВКонтакте»', text(participant.vk_url)],
        [
          'Краткие сведения о компетенциях, опыте, публикациях, достижениях',
          text(participant.competencies),
        ],
        ['Личный вклад в разработку инициативы', text(participant.personal_contribution)],
      ], { labelBold: true })
    );
  });

  // ── 3. Наставники ──────────────────────────────────────────────────────────
  blocks.push(
    paragraph('3. Сведения о наставнике (наставниках)', { bold: true, size: 24, spaceAfter: 120 })
  );
  if (mentors.length === 0) {
    blocks.push(paragraph('Наставники не заявлены.', { size: 22, spaceAfter: 240 }));
  } else {
    mentors.forEach((mentor, index) => {
      blocks.push(
        paragraph(`Наставник № ${index + 1}`, { bold: true, size: 22, spaceAfter: 80 }),
        table([
          ['Фамилия, имя, отчество (при наличии)', text(mentor.full_name)],
          ['Место работы', text(mentor.organization)],
          ['Должность', text(mentor.position)],
          ['Учёная степень', text(mentor.academic_degree)],
          ['Учёное звание', text(mentor.academic_title)],
          ['Контактный телефон', text(mentor.phone)],
          ['Адрес электронной почты', text(mentor.email)],
        ], { labelBold: true })
      );
    });
  }

  // ── Подтверждение и подпись ────────────────────────────────────────────────
  const captain = participants.find((participant) => participant.role === 'captain');
  blocks.push(
    paragraph(
      'Подтверждаем достоверность представленных сведений, ознакомлены с Положением о Конкурсе и принимаем его условия. Подтверждаем, что законотворческая инициатива является результатом самостоятельной творческой работы членов команды.',
      { size: 22, align: 'both', spaceAfter: 240 }
    ),
    paragraph(`Капитан команды: ${text(captain?.full_name)}`, { size: 22, spaceAfter: 120 }),
    paragraph('_________________________ / ______________________________', { size: 22, spaceAfter: 0 }),
    paragraph('(подпись)                                (расшифровка подписи)', { size: 18, spaceAfter: 240 }),
    paragraph(
      `Бланк сформирован системой ${formatMoscowHuman(now)}. Подписание и представление бланка — по желанию команды; согласия оформлены электронно при отправке заявки.`,
      { italic: true, size: 18 }
    )
  );

  return buildDocx(blocks.join(''), now);
}
