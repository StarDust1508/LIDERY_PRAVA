import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApplicationFormDocx } from './application-form.js';
import { readZipArchive } from './zip.js';

// Бланк заявки по Приложению № 1 (редакция 04.10.2026): «Заявка формируется
// системой в электронном виде и доступна участнику для скачивания в личном
// кабинете». Проверяем, что в бланк попадают именно данные заявки и что пустые
// поля не превращаются в «undefined» или дыру в документе.

/** Достаёт текст документа из собранного DOCX. */
function documentXml(buffer: Buffer): string {
  const entries = readZipArchive(buffer);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  assert.ok(document, 'в архиве нет word/document.xml');
  return document.data.toString('utf8');
}

type FormData = Parameters<typeof buildApplicationFormDocx>[0];

function formData(overrides: {
  application?: Record<string, unknown>;
  team?: Record<string, unknown>;
  participants?: Array<Record<string, unknown>>;
  mentors?: Array<Record<string, unknown>>;
} = {}): FormData {
  return {
    application: {
      public_number: 'ЛП-2027-000123',
      law_title: 'О правовом просвещении',
      act_level: 'federal',
      proposed_initiator: 'Правительство Российской Федерации',
      annotation: 'Инициатива закрепляет механизмы просвещения.',
      ai_usage: false,
      ai_usage_purpose: null,
      is_solo: false,
      solo_approved_at: null,
      season_title: 'Сезон 2026/2027',
      season_year: 2027,
      tech_status: 'submitted',
      ...overrides.application,
    },
    team: {
      name: 'Правовой десант',
      organization: 'МГЮА',
      city: 'Москва',
      direction_title: 'Правовое просвещение',
      ...overrides.team,
    },
    participants: overrides.participants ?? [
      {
        full_name: 'Иванова Мария Петровна',
        role: 'captain',
        birth_date: '2003-04-11',
        citizenship: 'Российская Федерация',
        region: 'г. Москва',
        settlement: 'Москва',
        category: 'student',
        organization: 'МГЮА',
        faculty: 'Институт права',
        course: '3',
        study_program: 'Юриспруденция',
        phone: '+7 900 000-00-01',
        email: 'ivanova@example.test',
        vk_url: 'https://vk.com/ivanova',
        competencies: 'Публикации по конституционному праву',
        personal_contribution: 'Разработала структуру законопроекта',
      },
      {
        full_name: 'Петров Иван Сергеевич',
        role: 'participant',
        birth_date: '2004-09-02',
        category: 'magistrant',
        email: 'petrov@example.test',
      },
    ],
    mentors: overrides.mentors ?? [
      {
        full_name: 'Сидоров Пётр Ильич',
        organization: 'МГЮА',
        position: 'доцент',
        academic_degree: 'кандидат юридических наук',
        academic_title: 'доцент',
        email: 'sidorov@example.test',
        phone: '+7 900 000-00-09',
      },
    ],
  } as unknown as FormData;
}

test('бланк заявки — корректный DOCX с заголовком Приложения № 1', () => {
  const buffer = buildApplicationFormDocx(formData(), new Date('2026-12-01T09:00:00Z'));
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK', 'DOCX должен быть ZIP-архивом');

  const xml = documentXml(buffer);
  assert.match(xml, /Приложение № 1/);
  assert.match(xml, /ФОРМА ЗАЯВКИ НА УЧАСТИЕ В КОНКУРСЕ/);
  assert.match(xml, /Лидеры права – 2027/);
  // Ссылка на редакцию, вводящую электронную форму, обязана быть в бланке.
  assert.match(xml, /редакции от 4 октября 2026 года/);
  assert.match(xml, /представление отдельного файла не требуется/);
});

test('реквизиты заявки и команды подставляются в бланк', () => {
  const xml = documentXml(buildApplicationFormDocx(formData(), new Date('2026-12-01T09:00:00Z')));

  assert.match(xml, /ЛП-2027-000123/);
  assert.match(xml, /Сезон 2026\/2027/);
  assert.match(xml, /Правовой десант/);
  assert.match(xml, /Правовое просвещение/);
  assert.match(xml, /О правовом просвещении/);
  assert.match(xml, /Правительство Российской Федерации/);
  // Место учёбы и город склеиваются через запятую.
  assert.match(xml, /МГЮА, Москва/);
});

test('уровень акта и категория участника показываются по-русски', () => {
  const xml = documentXml(
    buildApplicationFormDocx(
      formData({
        application: { act_level: 'federal' },
        participants: [{ full_name: 'Тестов Тест', role: 'participant', category: 'mo_leader' }],
      })
    )
  );
  assert.match(xml, /Федеральный закон/);
  assert.ok(!xml.includes('federal<'), 'код уровня акта не должен попадать в документ');
  assert.match(xml, /Лидер молодёжной организации/);
});

test('неизвестные коды не теряются, а показываются как есть', () => {
  // Значение из базы, которого нет в справочнике, лучше показать, чем скрыть.
  const xml = documentXml(
    buildApplicationFormDocx(
      formData({
        application: { act_level: 'municipal' },
        participants: [{ full_name: 'Тестов Тест', role: 'participant', category: 'other_category' }],
      })
    )
  );
  assert.match(xml, /municipal/);
  assert.match(xml, /other_category/);
});

test('пустые поля заполняются прочерком, а не пустотой', () => {
  const xml = documentXml(
    buildApplicationFormDocx(
      formData({
        application: { law_title: null, annotation: '   ' },
        participants: [{ full_name: 'Тестов Тест', role: 'participant' }],
        mentors: [],
      }),
      new Date('2026-12-01T09:00:00Z')
    )
  );
  assert.match(xml, /—/, 'пустое значение заменяется прочерком');
  assert.ok(!xml.includes('undefined'), 'в документ не должно попадать undefined');
  assert.ok(!xml.includes('null'), 'в документ не должно попадать null');
});

test('капитан идёт первым и помечен как капитан команды', () => {
  const xml = documentXml(
    buildApplicationFormDocx(
      formData({
        participants: [
          { full_name: 'Капитан К.', role: 'captain' },
          { full_name: 'Участник У.', role: 'participant' },
        ],
      })
    )
  );
  assert.match(xml, /Участник № 1 — капитан команды/);
  assert.match(xml, /Участник № 2(?! — капитан)/);
  assert.match(xml, /Капитан команды: Капитан К\./);
  // Подпись капитана — часть формы, её отсутствие сломало бы бланк.
  assert.match(xml, /\(подпись\)/);
  assert.match(xml, /\(расшифровка подписи\)/);
});

test('единоличное участие и использование ИИ описываются словами', () => {
  const solo = documentXml(
    buildApplicationFormDocx(
      formData({
        application: { is_solo: true, solo_approved_at: '2026-11-20T10:00:00Z' },
        participants: [{ full_name: 'Один О.', role: 'captain' }],
      })
    )
  );
  assert.match(solo, /да, согласовано с Оргкомитетом/);
  assert.match(solo, /20 ноября 2026 года/);

  const ai = documentXml(
    buildApplicationFormDocx(
      formData({ application: { ai_usage: true, ai_usage_purpose: 'подбор судебной практики' } })
    )
  );
  assert.match(ai, /да, цели: подбор судебной практики/);

  const noAi = documentXml(buildApplicationFormDocx(formData({ application: { ai_usage: false } })));
  assert.match(noAi, /Использование систем искусственного интеллекта/);
  assert.ok(noAi.includes('нет'), 'без ИИ в бланке должно стоять «нет»');
});

test('наставники выводятся по одному, а их отсутствие прямо указано', () => {
  const withMentors = documentXml(buildApplicationFormDocx(formData()));
  assert.match(withMentors, /Наставник № 1/);
  assert.match(withMentors, /Сидоров Пётр Ильич/);
  assert.match(withMentors, /кандидат юридических наук/);

  const withoutMentors = documentXml(buildApplicationFormDocx(formData({ mentors: [] })));
  assert.match(withoutMentors, /Наставники не заявлены/);
  assert.ok(!withoutMentors.includes('Наставник № 1'));
});

test('все участники попадают в бланк вместе со своими данными', () => {
  const xml = documentXml(buildApplicationFormDocx(formData({})));
  assert.match(xml, /Иванова Мария Петровна/);
  assert.match(xml, /Петров Иван Сергеевич/);
  assert.match(xml, /ivanova@example\.test/);
  assert.match(xml, /\+7 900 000-00-01/);
  assert.match(xml, /Публикации по конституционному праву/);
  assert.match(xml, /Разработала структуру законопроекта/);
  // Дата рождения — в формате «11 апреля 2003 года».
  assert.match(xml, /11 апреля 2003 года/);
});

test('опасные символы экранируются: данные не ломают документ', () => {
  const xml = documentXml(
    buildApplicationFormDocx(
      formData({
        team: { name: 'ООО «Ромашка» & <партнёры>' },
        application: { law_title: 'О внесении изменений <в закон>' },
        participants: [{ full_name: 'Иванов И. И. & Ко', role: 'captain' }],
      })
    )
  );
  assert.match(xml, /ООО «Ромашка» &amp; &lt;партнёры&gt;/);
  assert.match(xml, /О внесении изменений &lt;в закон&gt;/);
  assert.match(xml, /Иванов И\. И\. &amp; Ко/);
});

test('в подвале указан момент формирования бланка по московскому времени', () => {
  const xml = documentXml(buildApplicationFormDocx(formData(), new Date('2026-12-01T09:30:00Z')));
  assert.match(xml, /Бланк сформирован системой/);
  // 09:30 UTC — это 12:30 по Москве; время в документе не должно «плыть».
  assert.match(xml, /12:30/);
});
