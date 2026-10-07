import { buildDocx, paragraph, table } from './docx.js';
import { formatMoscowDateHuman } from './moscow-time.js';

// Бланки согласий из личного кабинета (ТЗ 06, п. 1.3).
//
// Согласия даются электронно при подаче заявки (Приложения № 10, 12, 13), а для
// несовершеннолетних дополнительно нужен подписанный скан (Приложение № 11).
// После отправки команда может скачать заполненные бланки для своего архива —
// например, чтобы распечатать и подписать по требованию организации.
//
// Текст согласия повторяет редакцию 04.10.2026: в бланке указываются версия,
// дата редакции и состав данных, на обработку которых дано согласие.

export type ConsentKind = 'pdn' | 'distribution' | 'legal_representative' | 'media';

interface ConsentDefinition {
  appendix: string;
  title: string;
  /** Согласие даёт законный представитель, а не сам участник. */
  byRepresentative: boolean;
  body: string[];
  scope?: Array<[string, string]>;
  documentCode: string;
}

const DEFINITIONS: Record<ConsentKind, ConsentDefinition> = {
  pdn: {
    appendix: 'Приложение № 10',
    title: 'СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ',
    byRepresentative: false,
    documentCode: 'consent_pdn',
    body: [
      'Я, нижеподписавшийся субъект персональных данных, свободно, своей волей и в своём интересе даю согласие на обработку моих персональных данных оператору конкурса «Лидеры права – 2027» в целях участия в конкурсе, оценки конкурсных материалов и связи по вопросам конкурса.',
      'Согласие даётся на совершение действий, предусмотренных пунктом 3 статьи 3 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных», как с использованием средств автоматизации, так и без их использования.',
      'Согласие действует до достижения целей обработки. Согласие может быть отозвано письменным обращением в адрес оператора; после отзыва обработка прекращается, а данные обезличиваются, за исключением сведений, хранение которых обязательно по закону.',
    ],
  },
  distribution: {
    appendix: 'Приложение № 12',
    title: 'СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ, РАЗРЕШЁННЫХ СУБЪЕКТОМ ДЛЯ РАСПРОСТРАНЕНИЯ',
    byRepresentative: false,
    documentCode: 'consent_distribution',
    body: [
      'Я даю согласие на распространение персональных данных в объёме, отмеченном ниже: отмеченные сведения могут быть опубликованы на сайте конкурса и в сообществе конкурса.',
      'Сведения, не отмеченные в таблице, распространению не подлежат. Согласие может быть отозвано в любой момент обращением в адрес оператора; публикация прекращается, однако уже распространённые сведения могут сохраняться у третьих лиц.',
    ],
    scope: [
      ['Фамилия, имя, отчество', 'согласие по отметке в заявке'],
      ['Изображение и голос (видеозапись защиты)', 'согласие по отметке в заявке'],
      ['Место обучения или работы', 'по решению участника'],
      ['Регион и населённый пункт', 'по решению участника'],
    ],
  },
  legal_representative: {
    appendix: 'Приложение № 11',
    title: 'СОГЛАСИЕ ЗАКОННОГО ПРЕДСТАВИТЕЛЯ НА УЧАСТИЕ НЕСОВЕРШЕННОЛЕТНЕГО В КОНКУРСЕ И ОБРАБОТКУ ЕГО ПЕРСОНАЛЬНЫХ ДАННЫХ',
    byRepresentative: true,
    documentCode: 'consent_legal_representative',
    body: [
      'Я, законный представитель (родитель или опекун) несовершеннолетнего участника, даю согласие на его участие в конкурсе «Лидеры права – 2027» и на обработку его персональных данных оператором конкурса.',
      'Подписанный бланк прикладывается к заявке сканом: электронной отметки для участников младше 18 лет недостаточно, поскольку согласие даёт лицо, не являющееся пользователем сайта.',
      'Согласие действует до достижения целей обработки и может быть отозвано письменным обращением законного представителя в адрес оператора.',
    ],
  },
  media: {
    appendix: 'Приложение № 13',
    title: 'СОГЛАСИЕ НА ИСПОЛЬЗОВАНИЕ ИЗОБРАЖЕНИЯ И ПРЕДОСТАВЛЕНИЕ ПРАВА ИСПОЛЬЗОВАНИЯ КОНКУРСНЫХ МАТЕРИАЛОВ',
    byRepresentative: false,
    documentCode: 'media_license',
    body: [
      'Я даю согласие на использование моего изображения (фотографии, видеозаписи выступления) и предоставляю оператору конкурса право использования конкурсных материалов, созданных в рамках участия в конкурсе.',
      'Материалы могут использоваться в информационных целях конкурса: публикация на сайте конкурса, в сообществе конкурса, в презентационных материалах. Использование в рекламных целях третьих лиц не допускается.',
      'Право использования предоставляется безвозмездно на срок действия исключительных прав с сохранением указания авторства, если автор не отказался от указания имени.',
    ],
  },
};

export interface ConsentDocumentData {
  teamName: string;
  directionTitle: string | null;
  publicNumber: string | null;
  version: string;
  revisionDate: string | null;
  participant: {
    full_name: string;
    birth_date?: string | null;
    email?: string | null;
    phone?: string | null;
    organization?: string | null;
    region?: string | null;
    settlement?: string | null;
    citizenship?: string | null;
    is_minor?: boolean | null;
  };
}

function value(input: unknown): string {
  if (input === null || input === undefined) return '—';
  const text = String(input).trim();
  return text === '' ? '—' : text;
}

/** Собирает бланк согласия (DOCX) с данными участника и местом для подписи. */
export function buildConsentDocx(kind: ConsentKind, data: ConsentDocumentData): Buffer {
  const definition = DEFINITIONS[kind];
  const blocks: string[] = [];

  blocks.push(
    paragraph(definition.appendix, { size: 24, align: 'right', spaceAfter: 0 }),
    paragraph(
      'к Положению о Десятом ежегодном федеральном научно-образовательном конкурсе «Лидеры права – 2027»',
      { size: 20, align: 'right', spaceAfter: 240 }
    ),
    paragraph(definition.title, { bold: true, size: 26, align: 'center', spaceAfter: 120 }),
    paragraph(
      `Редакция от ${formatMoscowDateHuman(data.revisionDate) ?? '4 октября 2026 года'}, версия ${data.version}. ` +
        (definition.byRepresentative
          ? 'Бланк заполнен системой конкурса для подписания законным представителем.'
          : 'Бланк заполнен системой конкурса; согласие дано электронно при подаче заявки.'),
      { italic: true, size: 20, align: 'center', spaceAfter: 240 }
    )
  );

  blocks.push(
    paragraph('Сведения о субъекте персональных данных', { bold: true, size: 24, spaceAfter: 120 }),
    table([
      ['Команда', value(data.teamName)],
      ['Направление конкурса', value(data.directionTitle)],
      ['Номер заявки', value(data.publicNumber)],
      ['Фамилия, имя, отчество', value(data.participant.full_name)],
      ...(definition.byRepresentative
        ? ([['Несовершеннолетний участник', value(data.participant.full_name)]] as Array<[string, string]>)
        : []),
      ['Дата рождения', value(data.participant.birth_date)],
      ['Гражданство', value(data.participant.citizenship)],
      ['Адрес электронной почты', value(data.participant.email)],
      ['Телефон', value(data.participant.phone)],
      ['Место обучения или работы', value(data.participant.organization)],
      ['Регион, населённый пункт', [value(data.participant.region), value(data.participant.settlement)].join(', ')],
    ])
  );

  for (const item of definition.body) {
    blocks.push(paragraph(item, { size: 22, align: 'both', spaceAfter: 160 }));
  }

  if (definition.scope) {
    blocks.push(
      paragraph('Объём разрешённых к распространению сведений', { bold: true, size: 22, spaceAfter: 120 }),
      table(definition.scope)
    );
  }

  blocks.push(
    paragraph(
      definition.byRepresentative
        ? 'Законный представитель: ______________________ / ______________________'
        : 'Субъект персональных данных: ______________________ / ______________________',
      { size: 22, spaceAfter: 240 }
    ),
    paragraph('«____» ______________ 20___ года', { size: 22, spaceAfter: 0 })
  );

  return buildDocx(blocks.join(''));
}

export function consentTitle(kind: ConsentKind): string {
  return DEFINITIONS[kind].title;
}

export function isConsentKind(value: unknown): value is ConsentKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEFINITIONS, value);
}
