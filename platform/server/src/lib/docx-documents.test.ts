import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDocx, escapeXml, paragraph, table } from './docx.js';
import { buildConsentDocx, consentTitle, isConsentKind } from './consent-forms.js';
import { readZipArchive } from './zip.js';

// Документы конкурса: бланк согласия (ТЗ 06, п. 1.3) и примитивы DOCX.
//
// Проверяется не «файл создался», а содержимое: подстановка данных участника,
// экранирование XML (в ФИО бывают кавычки и амперсанды), структура архива.

/** Достаёт текст документа из собранного DOCX. */
function documentXml(buffer: Buffer): string {
  const entries = readZipArchive(buffer);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  assert.ok(document, 'в архиве нет word/document.xml');
  return document.data.toString('utf8');
}

test('XML экранируется: данные не ломают документ', () => {
  assert.equal(escapeXml('ООО «Ромашка & Ко» <тест>'), 'ООО «Ромашка &amp; Ко» &lt;тест&gt;');
  assert.equal(escapeXml('кавычки " и \''), 'кавычки &quot; и &apos;');
});

test('DOCX собирается как корректный архив', () => {
  const buffer = buildDocx(paragraph('Проверка') + table([['Поле', 'Значение']]));
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');

  const names = readZipArchive(buffer).map((entry) => entry.name);
  assert.ok(names.includes('[Content_Types].xml'));
  assert.ok(names.includes('word/document.xml'));

  const xml = documentXml(buffer);
  assert.match(xml, /Проверка/);
  assert.match(xml, /Поле/);
});

test('бланк согласия содержит данные участника', () => {
  const buffer = buildConsentDocx('pdn', {
    teamName: 'Команда «Проверка & Ко»',
    directionTitle: 'Цифровое право',
    publicNumber: 'LP-2027-000042',
    version: '2026-10-04',
    revisionDate: '2026-10-04',
    participant: {
      full_name: 'Приёмов Пётр Петрович',
      birth_date: '2001-03-03',
      email: 'accept@example.ru',
      phone: '+7 900 333-33-33',
      organization: 'СГЮА',
      region: 'Саратовская область',
      settlement: 'г. Саратов',
      citizenship: 'Российская Федерация',
      is_minor: false,
    },
  });

  const xml = documentXml(buffer);
  assert.match(xml, /Приложение № 10/);
  assert.match(xml, /Приёмов Пётр Петрович/);
  assert.match(xml, /LP-2027-000042/);
  assert.match(xml, /accept@example\.ru/);
  // Амперсанд в названии команды должен быть экранирован.
  assert.match(xml, /Проверка &amp; Ко/);
  assert.doesNotMatch(xml, /Проверка & Ко/);
});

test('бланк законного представителя подписывает представитель', () => {
  const buffer = buildConsentDocx('legal_representative', {
    teamName: 'Младшая команда',
    directionTitle: null,
    publicNumber: null,
    version: '2026-10-04',
    revisionDate: null,
    participant: { full_name: 'Младшов Максим Олегович', is_minor: true, birth_date: '2010-05-05' },
  });
  const xml = documentXml(buffer);
  assert.match(xml, /Приложение № 11/);
  assert.match(xml, /Законный представитель/);
  assert.match(xml, /Младшов Максим Олегович/);
  // Пустые сведения печатаются прочерком, а не пустой ячейкой.
  assert.match(xml, /—/);
});

test('все виды согласий собираются и распознаются', () => {
  for (const kind of ['pdn', 'distribution', 'legal_representative', 'media'] as const) {
    assert.equal(isConsentKind(kind), true);
    assert.ok(consentTitle(kind).length > 10);
    const buffer = buildConsentDocx(kind, {
      teamName: 'Команда',
      directionTitle: null,
      publicNumber: null,
      version: '2026-10-04',
      revisionDate: '2026-10-04',
      participant: { full_name: 'Участников У. У.' },
    });
    assert.ok(buffer.length > 1000, `бланк ${kind} подозрительно мал`);
  }
  assert.equal(isConsentKind('unknown'), false);
  assert.equal(isConsentKind(null), false);
});

test('согласие на распространение перечисляет категории Приложения № 12', () => {
  const buffer = buildConsentDocx('distribution', {
    teamName: 'Команда',
    directionTitle: null,
    publicNumber: null,
    version: '2026-10-04',
    revisionDate: null,
    participant: { full_name: 'Участников У. У.' },
  });
  const xml = documentXml(buffer);
  assert.match(xml, /Фамилия, имя, отчество/);
  assert.match(xml, /Изображение и голос/);
});
