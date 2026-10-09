// Разделы админ-панели, описанные данными, а не разметкой (ТЗ 07, п. 2.3–2.14).
//
// Сервер отдаёт справочники и контент одним и тем же CRUD-интерфейсом, поэтому
// тринадцать экранов отличаются только списком полей, фильтрами и правами.
// Такой конфигурацией решаются три задачи: новый раздел делается за несколько
// строк, оформление таблиц и форм совпадает везде, а поля прав и ролей описаны
// в одном месте.

export type FieldType =
  | 'text'
  | 'textarea'
  | 'int'
  | 'numeric'
  | 'bool'
  | 'date'
  | 'timestamptz'
  | 'select'
  /** Структура переменного состава: редактируется текстом JSON. */
  | 'json'
  /** Файл в хранилище: выбор, загрузка и превью (MediaPicker). */
  | 'media';

export interface ResourceField {
  name: string;
  title: string;
  type: FieldType;
  hint?: string;
  maxLength?: number;
  options?: Array<{ value: string | number; title: string }>;
  /** Показывать в таблице списка. */
  inList?: boolean;
  /** Поле, из которого формируется человекочитаемый адрес. */
  slugSource?: boolean;
  required?: boolean;
}

export interface ResourceFilter {
  name: string;
  title: string;
  options: Array<{ value: string; title: string }>;
}

export interface ResourceConfig {
  /** Сегмент адреса API и раздела: /api/admin/<key>. */
  key: string;
  title: string;
  description: string;
  /** Раздел доступен только роли «администратор» (ТЗ 07, п. 1.3). */
  adminOnly?: boolean;
  slugFrom?: string;
  fields: ResourceField[];
  filters?: ResourceFilter[];
  searchable?: boolean;
  /** Подпись пустого состояния: что сделать, чтобы записи появились. */
  emptyText: string;
  /** Раздел только для чтения: архив перенесённых данных (ТЗ 10, п. 3.1). */
  readOnly?: boolean;
  /** Ключ, по которому сортируется список на сервере (для подсказки в интерфейсе). */
  orderHint?: string;
}

/** Годы архива: с первого сезона до текущего. */
const ARCHIVE_YEARS = Array.from({ length: 12 }, (_, index) => {
  const year = 2017 + index;
  return { value: String(year), title: String(year) };
});

/** Состояние публикации: опубликовано или нет. */
const PUBLICATION_STATES = [
  { value: 'true', title: 'Опубликовано' },
  { value: 'false', title: 'Не опубликовано' },
];

// Значения совпадают с CHECK в БД (миграция 019) и с ACT_LEVEL_TITLES общего
// модуля: раньше в списке был «муниципальный правовой акт», которого нет в
// схеме (ошибка 23514 при сохранении), и не было федерального конституционного
// закона, который схема допускает.
// Типы документов — те же коды, что в CHECK таблицы documents (миграция 025).
const DOCUMENT_TYPES = [
  { value: 'regulation', title: 'Положение' },
  { value: 'appendix', title: 'Приложение' },
  { value: 'offer', title: 'Оферта' },
  { value: 'privacy_policy', title: 'Политика обработки ПДн' },
  { value: 'terms', title: 'Пользовательское соглашение' },
  { value: 'cookies_policy', title: 'Политика cookie' },
  { value: 'jury_regulations', title: 'Регламент Жюри' },
  { value: 'mailing_consent', title: 'Согласие на информационные сообщения' },
  { value: 'consent_pdn', title: 'Согласие на обработку ПДн' },
  { value: 'consent_distribution', title: 'Согласие на распространение ПДн' },
  { value: 'consent_legal_representative', title: 'Согласие законного представителя' },
  { value: 'license_terms', title: 'Лицензия на материалы' },
  { value: 'appeal_form', title: 'Форма апелляции' },
  { value: 'other', title: 'Иной документ' },
];

// Номинации конкурса: в таблице winners номинация — свободный текст, значения
// заданы Положением (раздел 11).
const WINNER_NOMINATIONS = [
  { value: 'Лидеры права', title: 'Лидеры права' },
  { value: 'Наставник Лидеров права', title: 'Наставник Лидеров права' },
  { value: 'Лучший оратор', title: 'Лучший оратор' },
  { value: 'Приз зрительских симпатий', title: 'Приз зрительских симпатий' },
];

const ACT_LEVELS = [
  { value: 'federal_constitutional', title: 'Федеральный конституционный закон' },
  { value: 'federal', title: 'Федеральный закон' },
  { value: 'regional', title: 'Закон субъекта Российской Федерации' },
];

const STAGES = [
  { value: 'selection', title: 'Отборочный этап' },
  { value: 'stage1', title: 'Первый этап' },
  { value: 'debate', title: 'Второй (финальный) этап' },
];

export const RESOURCES: readonly ResourceConfig[] = [
  {
    key: 'legacy-applications',
    title: 'Заявки 2026 (архив)',
    description:
      'Заявки сезона 2026, перенесённые из прежней системы: плоская анкета с отметками согласий. Раздел только для чтения и выгрузки — старые записи не участвуют в приёме заявок и рейтинге.',
    adminOnly: true,
    readOnly: true,
    fields: [
      { name: 'legacy_id', title: 'Номер в прежней базе', type: 'int', inList: true },
      { name: 'full_name', title: 'Фамилия, имя, отчество', type: 'text', maxLength: 300, inList: true },
      { name: 'email', title: 'Электронная почта', type: 'text', maxLength: 250, inList: true },
      { name: 'phone', title: 'Телефон', type: 'text', maxLength: 32 },
      { name: 'organization', title: 'Организация', type: 'text', maxLength: 300, inList: true },
      { name: 'status', title: 'Статус', type: 'text', maxLength: 64, inList: true },
      { name: 'consent_pdn', title: 'Согласие на обработку ПДн', type: 'bool', inList: true },
      { name: 'consent_terms', title: 'Согласие с условиями', type: 'bool' },
      { name: 'consent_marketing', title: 'Согласие на рассылку', type: 'bool' },
      { name: 'consent_at', title: 'Время согласия', type: 'timestamptz' },
      { name: 'source_ip', title: 'Сетевой адрес', type: 'text', maxLength: 64 },
      { name: 'submitted_at', title: 'Дата заявки', type: 'timestamptz', inList: true },
      { name: 'imported_at', title: 'Дата переноса', type: 'timestamptz' },
      { name: 'legacy_source', title: 'Источник переноса', type: 'text', maxLength: 200 },
      { name: 'admin_notes', title: 'Заметки прежней админки', type: 'textarea', maxLength: 4000 },
    ],
    searchable: true,
    emptyText: 'Архив пуст: заявки сезона 2026 не переносились.',
  },
  {
    key: 'seasons',
    title: 'Сезоны',
    description:
      'Сроки конкурса: даты приёма заявок, технической проверки, этапов и финала. Сроки не хранятся в коде — кабинет и публичные страницы берут их отсюда.',
    adminOnly: true,
    fields: [
      { name: 'slug', title: 'Адрес', type: 'text', maxLength: 80, inList: true, hint: 'Например: 2027' },
      { name: 'title', title: 'Название', type: 'text', maxLength: 300, inList: true, required: true },
      { name: 'year', title: 'Год', type: 'int', inList: true },
      { name: 'status', title: 'Состояние', type: 'text', maxLength: 32, inList: true },
      { name: 'is_active', title: 'Активный сезон', type: 'bool', inList: true },
      { name: 'application_open_at', title: 'Начало приёма заявок', type: 'timestamptz' },
      { name: 'application_close_at', title: 'Окончание приёма заявок', type: 'timestamptz' },
      { name: 'tech_check_from', title: 'Техническая проверка с', type: 'timestamptz' },
      { name: 'tech_check_to', title: 'Техническая проверка по', type: 'timestamptz' },
      { name: 'stage1_from', title: 'Первый этап с', type: 'timestamptz' },
      { name: 'stage1_to', title: 'Первый этап по', type: 'timestamptz' },
      { name: 'final_from', title: 'Финал с', type: 'timestamptz' },
      { name: 'final_to', title: 'Финал по', type: 'timestamptz' },
      // Даты, которые публикует страница «Календарь»: без них этапы
      // показывались как «по календарному плану», а заполнить их можно было
      // только через SQL.
      { name: 'expertise_from', title: 'Экспертиза отборочного этапа с', type: 'timestamptz' },
      { name: 'expertise_to', title: 'Экспертиза отборочного этапа по', type: 'timestamptz' },
      { name: 'protocol_selection_at', title: 'Публикация протокола отборочного этапа', type: 'timestamptz' },
      { name: 'video_publication_from', title: 'Публикация видеороликов с', type: 'timestamptz' },
      { name: 'video_publication_to', title: 'Публикация видеороликов по', type: 'timestamptz' },
      { name: 'stage1_evaluation_from', title: 'Оценка первого этапа с', type: 'timestamptz' },
      { name: 'stage1_evaluation_to', title: 'Оценка первого этапа по', type: 'timestamptz' },
      { name: 'protocol_stage1_at', title: 'Публикация протокола первого этапа', type: 'timestamptz' },
      { name: 'masterclasses_from', title: 'Мастер-классы с', type: 'timestamptz' },
      { name: 'masterclasses_to', title: 'Мастер-классы по', type: 'timestamptz' },
      { name: 'post_final_from', title: 'После финала с', type: 'timestamptz' },
      { name: 'post_final_to', title: 'После финала по', type: 'timestamptz' },
      { name: 'appeal_window_days', title: 'Срок апелляции, рабочих дней', type: 'int' },
      { name: 'timezone', title: 'Часовой пояс', type: 'text', maxLength: 64 },
      { name: 'description', title: 'Описание', type: 'textarea', maxLength: 5000 },
    ],
    searchable: true,
    emptyText: 'Сезонов пока нет. Первый сезон создаётся вместе с публикацией Положения.',
  },
  {
    key: 'directions',
    title: 'Направления конкурса',
    description: 'Направления, по которым команды подают законотворческие инициативы (Приложение № 2).',
    adminOnly: true,
    fields: [
      { name: 'code', title: 'Код', type: 'text', maxLength: 80, inList: true },
      { name: 'title', title: 'Направление', type: 'text', maxLength: 500, inList: true, required: true },
      { name: 'description', title: 'Пояснение', type: 'textarea', maxLength: 5000 },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
      { name: 'is_active', title: 'Действует', type: 'bool', inList: true },
    ],
    searchable: true,
    emptyText: 'Направлений пока нет. Они должны совпадать с Приложением № 2 к Положению.',
  },
  {
    key: 'criteria',
    title: 'Критерии оценки',
    description:
      'Критерии по этапам (раздел 10 Положения): суммы по этапам — 70, 80 и 45 баллов. Изменение критериев после публикации протокола запрещено без снятия с публикации.',
    adminOnly: true,
    fields: [
      { name: 'stage', title: 'Этап', type: 'select', options: STAGES, inList: true, required: true },
      { name: 'code', title: 'Код', type: 'text', maxLength: 80, inList: true },
      { name: 'title', title: 'Критерий', type: 'text', maxLength: 300, inList: true, required: true },
      { name: 'description', title: 'Что оценивается', type: 'textarea', maxLength: 2000 },
      { name: 'max_score', title: 'Максимальный балл', type: 'int', inList: true, required: true },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
      { name: 'is_active', title: 'Действует', type: 'bool' },
    ],
    filters: [{ name: 'stage', title: 'Этап', options: STAGES }],
    emptyText: 'Критериев пока нет. Они переносятся из раздела 10 Положения без изменений.',
  },
  {
    key: 'experts',
    title: 'Эксперты и комиссии',
    description:
      'Конкурсная комиссия, Жюри и эксперты. Публикуются только те, у кого отмечено «Показывать на сайте».',
    adminOnly: true,
    fields: [
      { name: 'full_name', title: 'Фамилия, имя, отчество', type: 'text', maxLength: 200, inList: true, required: true },
      { name: 'organization', title: 'Организация', type: 'text', maxLength: 300, inList: true },
      { name: 'position', title: 'Должность', type: 'text', maxLength: 300 },
      { name: 'degree', title: 'Учёная степень', type: 'text', maxLength: 200 },
      {
        name: 'role',
        title: 'Роль',
        type: 'select',
        options: [
          { value: 'chair', title: 'Председатель' },
          { value: 'member', title: 'Член комиссии' },
        ],
        inList: true,
      },
      { name: 'stage', title: 'Этап', type: 'select', options: STAGES, inList: true },
      { name: 'about', title: 'О человеке', type: 'textarea', maxLength: 4000 },
      { name: 'photo_media_id', title: 'Фотография', type: 'media' },
      { name: 'email', title: 'Электронная почта', type: 'text', maxLength: 250, hint: 'Внутреннее поле: на сайте не публикуется.' },
      { name: 'phone', title: 'Телефон', type: 'text', maxLength: 32, hint: 'Внутреннее поле.' },
      { name: 'is_public', title: 'Показывать на сайте', type: 'bool', inList: true },
      { name: 'is_active', title: 'Действующий', type: 'bool' },
      { name: 'notes', title: 'Заметки Оргкомитета', type: 'textarea', maxLength: 3000 },
    ],
    filters: [
      { name: 'stage', title: 'Этап', options: STAGES },
      {
        name: 'role',
        title: 'Роль',
        options: [
          { value: 'chair', title: 'Председатель' },
          { value: 'member', title: 'Член комиссии' },
        ],
      },
    ],
    searchable: true,
    emptyText: 'Список пуст. Добавьте членов Конкурсной комиссии и Жюри — они появятся на странице «Оргкомитет и эксперты».',
  },
  {
    key: 'jury-members',
    title: 'Жюри финального этапа',
    description: 'Члены Жюри, оценивающие дебаты и участвующие в голосовании Гранд-финала.',
    adminOnly: true,
    fields: [
      { name: 'full_name', title: 'Фамилия, имя, отчество', type: 'text', maxLength: 200, inList: true, required: true },
      { name: 'organization', title: 'Организация', type: 'text', maxLength: 300, inList: true },
      { name: 'position', title: 'Должность', type: 'text', maxLength: 300 },
      { name: 'role', title: 'Роль', type: 'text', maxLength: 32, inList: true },
      { name: 'stage', title: 'Этап', type: 'select', options: STAGES },
      { name: 'email', title: 'Электронная почта', type: 'text', maxLength: 250 },
      { name: 'phone', title: 'Телефон', type: 'text', maxLength: 32 },
      { name: 'is_active', title: 'Действующий', type: 'bool', inList: true },
      { name: 'notes', title: 'Заметки', type: 'textarea', maxLength: 3000 },
    ],
    searchable: true,
    emptyText: 'Список Жюри пуст. Состав утверждается Оргкомитетом до финала.',
  },
  {
    key: 'partners',
    title: 'Партнёры конкурса',
    description: 'Партнёры и спонсоры: показываются в разделе «Партнёры конкурса» и в подвале сайта.',
    fields: [
      { name: 'name', title: 'Название', type: 'text', maxLength: 300, inList: true, required: true },
      { name: 'partner_type', title: 'Тип партнёра', type: 'text', maxLength: 64, inList: true, hint: 'Например: генеральный партнёр' },
      { name: 'url', title: 'Сайт', type: 'text', maxLength: 500 },
      { name: 'description', title: 'Описание', type: 'textarea', maxLength: 2000 },
      { name: 'logo_media_id', title: 'Логотип', type: 'media' },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
      { name: 'is_active', title: 'Показывать', type: 'bool', inList: true },
    ],
    searchable: true,
    emptyText: 'Партнёров пока нет. После утверждения списка они появятся на сайте.',
  },
  {
    key: 'news',
    title: 'Новости и видеосюжеты',
    description: 'Публикации раздела «Новости». Адрес формируется из заголовка, если оставить поле пустым.',
    fields: [
      { name: 'title', title: 'Заголовок', type: 'text', maxLength: 300, inList: true, required: true, slugSource: true },
      { name: 'slug', title: 'Адрес', type: 'text', maxLength: 200, hint: 'Оставьте пустым — адрес соберётся из заголовка.' },
      {
        name: 'type',
        title: 'Тип',
        type: 'select',
        options: [
          { value: 'news', title: 'Новость' },
          { value: 'video', title: 'Видеосюжет' },
        ],
        inList: true,
      },
      { name: 'excerpt', title: 'Краткое описание', type: 'textarea', maxLength: 2000, inList: true },
      { name: 'body', title: 'Текст', type: 'textarea', maxLength: 100000 },
      { name: 'season_id', title: 'Сезон (идентификатор)', type: 'int' },
      {
        name: 'video_url',
        title: 'Ссылка на видео',
        type: 'text',
        maxLength: 2000,
        hint: 'Только российские сервисы: «ВКонтакте», Rutube, Дзен, Одноклассники.',
      },
      { name: 'cover_media_id', title: 'Обложка', type: 'media' },
      { name: 'published_at', title: 'Дата публикации', type: 'timestamptz', inList: true },
      { name: 'is_published', title: 'Опубликовано', type: 'bool', inList: true },
    ],
    filters: [
      {
        name: 'type',
        title: 'Тип',
        options: [
          { value: 'news', title: 'Новость' },
          { value: 'video', title: 'Видеосюжет' },
        ],
      },
    ],
    searchable: true,
    emptyText: 'Публикаций пока нет. Первая новость появится здесь после публикации.',
  },
  {
    key: 'documents',
    title: 'Документы',
    description:
      'Положение, Приложения № 1–14 и юридические документы. Включайте документ, только когда его редакция утверждена: с этого момента он доступен на сайте.',
    fields: [
      { name: 'title', title: 'Название', type: 'text', maxLength: 300, inList: true, required: true },
      { name: 'type', title: 'Тип', type: 'text', maxLength: 64, inList: true, hint: 'regulation, appendix, offer, privacy_policy…' },
      { name: 'version', title: 'Версия', type: 'text', maxLength: 64, inList: true },
      { name: 'revision_date', title: 'Дата редакции', type: 'date', inList: true },
      { name: 'external_url', title: 'Ссылка на файл', type: 'text', maxLength: 2000 },
      { name: 'media_id', title: 'Файл в хранилище', type: 'media' },
      { name: 'requires_acceptance', title: 'Требует согласия', type: 'bool' },
      { name: 'is_active', title: 'Опубликован', type: 'bool', inList: true },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
    ],
    filters: [{ name: 'type', title: 'Тип', options: DOCUMENT_TYPES }],
    searchable: true,
    emptyText: 'Документов пока нет. Положение и приложения загружаются перед открытием приёма заявок.',
  },
  {
    key: 'masterclasses',
    title: 'Мастер-классы',
    description:
      'Анонсы и записи. Прошедший мастер-класс публикуется только с записью (ТЗ 04, п. 3.6).',
    fields: [
      { name: 'title', title: 'Тема', type: 'text', maxLength: 300, inList: true, required: true, slugSource: true },
      { name: 'slug', title: 'Адрес', type: 'text', maxLength: 200, hint: 'Оставьте пустым — адрес соберётся из темы.' },
      { name: 'topic', title: 'Тематика', type: 'text', maxLength: 200, inList: true },
      { name: 'season_id', title: 'Сезон (идентификатор)', type: 'int' },
      { name: 'speaker', title: 'Спикер', type: 'text', maxLength: 300, inList: true, required: true },
      { name: 'speaker_info', title: 'О спикере', type: 'textarea', maxLength: 2000 },
      { name: 'description', title: 'Описание', type: 'textarea', maxLength: 10000 },
      {
        name: 'status',
        title: 'Состояние',
        type: 'select',
        options: [
          { value: 'announced', title: 'Анонс' },
          { value: 'past', title: 'Прошедший' },
          { value: 'cancelled', title: 'Отменён' },
        ],
        inList: true,
        hint: 'Отменённое занятие на сайте не показывается, но остаётся в списке Оргкомитета.',
      },
      { name: 'starts_at', title: 'Дата и время (МСК)', type: 'timestamptz', inList: true },
      { name: 'place', title: 'Место или ссылка', type: 'text', maxLength: 300 },
      { name: 'recording_url', title: 'Ссылка на запись', type: 'text', maxLength: 2000 },
      { name: 'media_id', title: 'Файл записи', type: 'media' },
      { name: 'cover_media_id', title: 'Обложка', type: 'media' },
      { name: 'is_published', title: 'Опубликовано', type: 'bool', inList: true },
      {
        name: 'materials',
        title: 'Материалы занятия',
        type: 'json',
        hint: 'Массив объектов { title, url }: публикуются в карточке прошедшего мастер-класса.',
      },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
    ],
    filters: [
      {
        name: 'status',
        title: 'Состояние',
        options: [
          { value: 'announced', title: 'Анонс' },
          { value: 'past', title: 'Прошедший' },
          { value: 'cancelled', title: 'Отменён' },
        ],
      },
      { name: 'is_published', title: 'Опубликовано', options: [{ value: 'true', title: 'Да' }, { value: 'false', title: 'Нет' }] },
    ],
    searchable: true,
    emptyText: 'Мастер-классов пока нет. Анонс появится на сайте сразу после сохранения.',
  },
  {
    key: 'winners',
    title: 'Победители',
    description:
      'Победители по годам и номинациям. Фамилии публикуются только при согласии Приложения № 12 — иначе пишите состав обезличенно.',
    fields: [
      { name: 'season_year', title: 'Год сезона', type: 'int', inList: true, required: true },
      { name: 'nomination', title: 'Номинация', type: 'text', maxLength: 200, inList: true, required: true },
      { name: 'place', title: 'Место', type: 'int', inList: true },
      { name: 'team_name', title: 'Команда', type: 'text', maxLength: 200, inList: true },
      { name: 'participants_text', title: 'Состав команды', type: 'textarea', maxLength: 2000 },
      { name: 'mentors_text', title: 'Наставники', type: 'textarea', maxLength: 2000 },
      { name: 'initiative_title', title: 'Законопроект', type: 'text', maxLength: 300, inList: true },
      { name: 'announcement', title: 'Описание', type: 'textarea', maxLength: 4000 },
      { name: 'photo_media_id', title: 'Фотография', type: 'media' },
      { name: 'video_url', title: 'Видеосюжет', type: 'text', maxLength: 2000 },
      { name: 'season_id', title: 'Сезон (идентификатор)', type: 'int' },
      { name: 'team_id', title: 'Команда в системе (идентификатор)', type: 'int' },
      { name: 'is_published', title: 'Опубликовано', type: 'bool', inList: true },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
    ],
    filters: [{ name: 'nomination', title: 'Номинация', options: WINNER_NOMINATIONS }],
    searchable: true,
    emptyText: 'Победителей пока нет. Записи вносятся после Гранд-финала.',
  },
  {
    key: 'pages',
    title: 'Страницы сайта',
    description:
      'Тексты разделов «О конкурсе», «История конкурса», «Частые вопросы», «Апелляции» и других. Правка здесь меняет текст на сайте без выката.',
    adminOnly: true,
    fields: [
      { name: 'title', title: 'Заголовок', type: 'text', maxLength: 300, inList: true, required: true, slugSource: true },
      { name: 'slug', title: 'Адрес', type: 'text', maxLength: 200, hint: 'Например: history, faq, appeals' },
      {
        name: 'type',
        title: 'Тип',
        type: 'select',
        options: [
          { value: 'page', title: 'Страница' },
          { value: 'history', title: 'История конкурса' },
          { value: 'faq', title: 'Частые вопросы' },
        ],
        inList: true,
      },
      { name: 'excerpt', title: 'Краткое описание', type: 'textarea', maxLength: 1000 },
      { name: 'body', title: 'Текст', type: 'textarea', maxLength: 100000 },
      { name: 'seo_title', title: 'Заголовок для поиска', type: 'text', maxLength: 200 },
      { name: 'seo_description', title: 'Описание для поиска', type: 'textarea', maxLength: 400 },
      { name: 'og_media_id', title: 'Обложка для соцсетей', type: 'media' },
      { name: 'is_published', title: 'Опубликовано', type: 'bool', inList: true },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
    ],
    searchable: true,
    emptyText: 'Страниц пока нет. Если страница не заполнена, сайт показывает текст по умолчанию.',
  },
  {
    key: 'initiatives',
    title: 'Архив законопроектов',
    description:
      'Инициативы для публичного архива. Публикация — решение Оргкомитета: инициативы дисквалифицированных команд система не публикует.',
    fields: [
      { name: 'title', title: 'Название инициативы', type: 'text', maxLength: 300, inList: true, required: true, slugSource: true },
      { name: 'slug', title: 'Адрес', type: 'text', maxLength: 200, hint: 'Оставьте пустым — адрес соберётся из названия.' },
      { name: 'team_name', title: 'Команда', type: 'text', maxLength: 200, inList: true },
      { name: 'archive_year', title: 'Год архива', type: 'int', inList: true },
      { name: 'act_level', title: 'Уровень акта', type: 'select', options: ACT_LEVELS, inList: true },
      { name: 'annotation', title: 'Аннотация', type: 'textarea', maxLength: 1000 },
      { name: 'proposed_initiator', title: 'Предлагаемый субъект права инициативы', type: 'text', maxLength: 300 },
      { name: 'result_place', title: 'Результат (место)', type: 'int' },
      { name: 'nomination', title: 'Номинация', type: 'text', maxLength: 200 },
      { name: 'direction_id', title: 'Направление (идентификатор)', type: 'int' },
      { name: 'season_id', title: 'Сезон (идентификатор)', type: 'int' },
      { name: 'team_id', title: 'Команда в системе (идентификатор)', type: 'int' },
      { name: 'law_draft_media_id', title: 'Законопроект', type: 'media' },
      { name: 'explanatory_note_media_id', title: 'Записка', type: 'media' },
      { name: 'video_url', title: 'Видеоролик', type: 'text', maxLength: 2000 },
      { name: 'authors_public', title: 'Согласие на распространение получено', type: 'bool', inList: true },
      { name: 'files_public', title: 'Лицензия на материалы получена', type: 'bool', inList: true },
      { name: 'is_published', title: 'Опубликовано', type: 'bool', inList: true },
      { name: 'sort_order', title: 'Порядок', type: 'int' },
    ],
    // Фильтры архива (ТЗ 07, п. 2.14а): сезон, направление, год, уровень акта и
    // состояние публикации — иначе в архиве за несколько сезонов не разобраться.
    filters: [
      { name: 'act_level', title: 'Уровень акта', options: ACT_LEVELS },
      { name: 'archive_year', title: 'Год архива', options: ARCHIVE_YEARS },
      { name: 'is_published', title: 'Публикация', options: PUBLICATION_STATES },
    ],
    searchable: true,
    emptyText: 'Архив пуст. Инициативы попадают сюда после решения Оргкомитета о публикации.',
  },
];

export function findResource(key: string): ResourceConfig | undefined {
  return RESOURCES.find((resource) => resource.key === key);
}
