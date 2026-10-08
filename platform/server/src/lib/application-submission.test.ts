import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import {
  DISTRIBUTION_CATEGORIES,
  collectSubmissionErrors,
  parseSubmission,
  type SubmissionContext,
  type SubmissionInput,
} from './application-submission.js';

// Правила комплектности заявки (п. 4.3, 4.8, 4.9, 7.2–7.5 Положения).
//
// Модуль работает через клиент БД, поэтому в тестах используется подстановочный
// клиент: он отвечает на запросы по образцу SQL. Так проверяются ровно правила —
// возраст, численность, согласия, скан для несовершеннолетних, наставники и
// комплект материалов, — без поднятой базы.

interface StubData {
  application?: Array<Record<string, unknown>>;
  participants?: Array<Record<string, unknown>>;
  mentors?: Array<Record<string, unknown>>;
  requirements?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
  consentScan?: boolean;
  /** Участники других команд с той же почтой (проверка уникальности). */
  otherTeams?: Array<Record<string, unknown>>;
}

function stubClient(data: StubData): pg.PoolClient {
  const rows = (value: unknown): { rows: Array<Record<string, unknown>> } => ({
    rows: (value ?? []) as Array<Record<string, unknown>>,
  });

  return {
    query: async (sql: string, params?: unknown[]) => {
      if (/FROM applications WHERE id/.test(sql)) {
        return rows(data.application ?? [{ is_solo: false, law_title: 'Законопроект' }]);
      }
      if (/FROM participants\s+WHERE team_id = \$1\s+ORDER BY CASE/.test(sql)) {
        return rows(data.participants ?? []);
      }
      if (/FROM application_materials[\s\S]*type = 'consent_legal_rep'/.test(sql)) {
        return rows(data.consentScan === true ? [{ id: 1 }] : []);
      }
      if (/FROM mentors WHERE team_id/.test(sql)) {
        return rows(data.mentors ?? []);
      }
      if (/FROM material_requirements/.test(sql)) {
        return rows(data.requirements ?? []);
      }
      if (/FROM application_materials[\s\S]*type = \$2/.test(sql)) {
        const type = params?.[1];
        const found = (data.materials ?? []).filter((row) => row.type === type);
        return rows(found);
      }
      throw new Error(`Неожиданный запрос в тесте: ${sql.slice(0, 80)}`);
    },
  } as unknown as pg.PoolClient;
}

const CONTEXT: SubmissionContext = {
  teamId: 1,
  seasonId: 1,
  applicationId: 1,
  ip: '127.0.0.1',
  userAgent: 'test',
  input: parseSubmission({ confirm_regulation: true, image_license: true }).value as SubmissionInput,
};

function participant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    full_name: 'Участников Участник Участникович',
    role: 'member',
    is_minor: false,
    consent_pdn: true,
    consent_legal_representative: false,
    ...overrides,
  };
}

test('комплектная заявка проходит проверку', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [
        participant({ id: 1, role: 'captain' }),
        participant({ id: 2, full_name: 'Второй Участник' }),
      ],
      materials: [{ type: 'law_draft' }],
      requirements: [{ type: 'law_draft', title: 'Текст законопроекта' }],
    }),
    CONTEXT
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.minorScanMissing, false);
});

test('численность команды: один участник и пять участников отклоняются', async () => {
  const one = await collectSubmissionErrors(
    stubClient({ participants: [participant({ role: 'captain' })], requirements: [] }),
    CONTEXT
  );
  assert.ok(one.errors.some((error) => error.includes('от 2 до 4 участников')));

  const five = await collectSubmissionErrors(
    stubClient({
      participants: [
        participant({ id: 1, role: 'captain' }),
        participant({ id: 2 }),
        participant({ id: 3 }),
        participant({ id: 4 }),
        participant({ id: 5 }),
      ],
      requirements: [],
    }),
    CONTEXT
  );
  assert.ok(five.errors.some((error) => error.includes('от 2 до 4 участников')));
});

test('единоличное участие допускается только с одним участником', async () => {
  const solo = await collectSubmissionErrors(
    stubClient({
      application: [{ is_solo: true, law_title: 'Законопроект' }],
      participants: [participant({ role: 'captain' }), participant({ id: 2 })],
      requirements: [],
    }),
    CONTEXT
  );
  assert.ok(solo.errors.some((error) => error.includes('ровно один участник')));

  const soloOk = await collectSubmissionErrors(
    stubClient({
      application: [{ is_solo: true, law_title: 'Законопроект' }],
      participants: [participant({ role: 'captain' })],
      requirements: [],
    }),
    CONTEXT
  );
  assert.deepEqual(soloOk.errors, []);
});

test('капитан должен быть ровно один', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [participant({ id: 1, role: 'captain' }), participant({ id: 2, role: 'captain' })],
      requirements: [],
    }),
    CONTEXT
  );
  assert.ok(result.errors.some((error) => error.includes('ровно один капитан')));
});

test('согласия участника и наставника обязательны', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [
        participant({ id: 1, role: 'captain', consent_pdn: false }),
        participant({ id: 2 }),
      ],
      mentors: [{ id: 1, full_name: 'Наставников Л. И.', consent_pdn: false }],
      requirements: [],
    }),
    CONTEXT
  );
  assert.ok(result.errors.some((error) => error.includes('отсутствует согласие')));
  assert.ok(result.errors.some((error) => error.includes('Наставник')));
});

test('наставников не больше двух', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [participant({ id: 1, role: 'captain' }), participant({ id: 2 })],
      mentors: [
        { id: 1, full_name: 'Первый', consent_pdn: true },
        { id: 2, full_name: 'Второй', consent_pdn: true },
        { id: 3, full_name: 'Третий', consent_pdn: true },
      ],
      requirements: [],
    }),
    CONTEXT
  );
  assert.ok(result.errors.some((error) => error.includes('не более двух наставников')));
});

test('несовершеннолетний без скана даёт отдельный признак статуса', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [
        participant({ id: 1, role: 'captain' }),
        participant({ id: 2, is_minor: true, consent_legal_representative: true }),
      ],
      consentScan: false,
      requirements: [],
    }),
    CONTEXT
  );
  assert.equal(result.minorScanMissing, true);
  assert.ok(result.errors.some((error) => error.includes('Приложение № 11')));
});

test('несовершеннолетний со сканом проходит', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [
        participant({ id: 1, role: 'captain' }),
        participant({ id: 2, is_minor: true, consent_legal_representative: true }),
      ],
      consentScan: true,
      requirements: [],
    }),
    CONTEXT
  );
  assert.equal(result.minorScanMissing, false);
  assert.deepEqual(result.errors, []);
});

test('без названия законопроекта заявка не уходит', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      application: [{ is_solo: false, law_title: null }],
      participants: [participant({ id: 1, role: 'captain' }), participant({ id: 2 })],
      requirements: [],
    }),
    CONTEXT
  );
  assert.ok(result.errors.some((error) => error.includes('наименование законопроекта')));
});

test('отсутствующий обязательный материал перечисляется по названию', async () => {
  const result = await collectSubmissionErrors(
    stubClient({
      participants: [participant({ id: 1, role: 'captain' }), participant({ id: 2 })],
      requirements: [
        { type: 'law_draft', title: 'Текст законопроекта' },
        { type: 'explanatory_note', title: 'Пояснительная записка' },
      ],
      materials: [{ type: 'law_draft' }],
    }),
    CONTEXT
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? '', /Пояснительная записка/);
});

test('подтверждения согласий разбираются и проверяются', () => {
  assert.ok(parseSubmission(null).error);
  assert.match(parseSubmission({}).error ?? '', /Положением/);
  assert.match(parseSubmission({ confirm_regulation: true }).error ?? '', /изображения/);

  const ok = parseSubmission({
    confirm_regulation: true,
    image_license: true,
    distribution: [{ participant_id: 3, categories: { full_name: true, image_voice: true } }],
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.value?.distribution.length, 1);
  const entry = ok.value?.distribution[0];
  assert.equal(entry?.participant_id, 3);
  assert.equal(entry?.categories.full_name, true);
  // Неотмеченные категории — «нет»: согласие даётся по каждой строке отдельно.
  assert.equal(entry?.categories.social_link, false);
  assert.equal(DISTRIBUTION_CATEGORIES.length, 6);
});

test('согласие на распространение с некорректным участником отклоняется', () => {
  const result = parseSubmission({
    confirm_regulation: true,
    image_license: true,
    distribution: [{ participant_id: 'не число' }],
  });
  assert.match(result.error ?? '', /не указан участник/);
});
