// Структура главной навигации (ТЗ 08, п. 1.1).
//
// Меню крупнее прежнего и с раскрывающимися разделами: каждый пункт верхнего
// уровня — не ссылка «в никуда», а группа с самостоятельными страницами. Если
// страницы ещё нет, пункт ведёт на раздел с якорем, чтобы ссылку можно было
// скопировать и переслать (ТЗ 08, п. 3.3).

export interface NavChild {
  title: string;
  path: string;
  /** Внешняя ссылка: открывается в новой вкладке, не участвует в подсветке. */
  external?: boolean;
}

export interface NavSection {
  title: string;
  path: string;
  children: NavChild[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'О конкурсе',
    path: '/about',
    children: [
      { title: 'Общее описание', path: '/about' },
      { title: 'Учредитель и партнёры', path: '/about/partners' },
      { title: 'История конкурса', path: '/about/history' },
      { title: 'Оргкомитет и эксперты', path: '/about/organizers' },
      { title: 'Положение (PDF)', path: '/about/regulations' },
      { title: 'Частые вопросы', path: '/about/faq' },
    ],
  },
  {
    title: 'Этапы',
    path: '/stages',
    children: [
      { title: 'Обзор этапов', path: '/stages' },
      { title: 'Отборочный этап', path: '/stages/selection' },
      { title: 'Первый этап', path: '/stages/first' },
      { title: 'Второй (финальный) этап', path: '/stages/final' },
      { title: 'Календарь', path: '/stages/calendar' },
      { title: 'Критерии оценки', path: '/stages/criteria' },
      { title: 'Апелляции', path: '/stages/appeals' },
    ],
  },
  {
    title: 'Участникам',
    path: '/participants',
    children: [
      { title: 'Как участвовать', path: '/participants' },
      { title: 'Требования к участникам', path: '/participants/requirements' },
      { title: 'Конкурсные материалы', path: '/participants/materials' },
      { title: 'Требования к видеоролику', path: '/participants/video-requirements' },
      { title: 'Подать заявку', path: '/apply' },
    ],
  },
  {
    title: 'Мастер-классы',
    path: '/masterclasses',
    children: [
      { title: 'Анонсы', path: '/masterclasses' },
      { title: 'Записи прошедших', path: '/masterclasses/past' },
    ],
  },
  {
    title: 'Архив законопроектов',
    path: '/initiatives',
    children: [
      { title: 'Все инициативы', path: '/initiatives' },
      { title: 'По годам', path: '/initiatives#years' },
      { title: 'По направлениям', path: '/initiatives#directions' },
      { title: 'Поиск по архиву', path: '/initiatives#search' },
    ],
  },
  {
    title: 'Победители',
    path: '/winners',
    children: [
      { title: 'По годам', path: '/winners' },
      { title: 'Номинации', path: '/winners#nominations' },
    ],
  },
  {
    title: 'Новости',
    path: '/news',
    children: [
      { title: 'Все материалы', path: '/news' },
      { title: 'Видеосюжеты', path: '/news?type=video' },
    ],
  },
  {
    title: 'Документы',
    path: '/documents',
    children: [
      { title: 'Положение', path: '/about/regulations' },
      { title: 'Приложения № 1–17', path: '/documents#appendices' },
      { title: 'Оферта', path: '/legal/offer' },
      { title: 'Политика обработки персональных данных', path: '/legal/privacy' },
      { title: 'Согласие на обработку персональных данных', path: '/legal/pdn-consent' },
      { title: 'Согласие законного представителя', path: '/legal/pdn-consent-minor' },
      { title: 'Согласие на распространение', path: '/legal/distribution-consent' },
      { title: 'Лицензия на материалы', path: '/legal/media-license' },
      { title: 'Политика cookie', path: '/legal/cookies' },
      { title: 'Пользовательское соглашение', path: '/legal/terms' },
      { title: 'Регламент Жюри', path: '/legal/jury-regulations' },
      // Полное название политики остаётся в юридической строке подвала; в
      // колонке-карте сайта подпись короткая — иначе она рвётся на две строки
      // и колонка выглядит неопрятно на фоне соседних.
    ],
  },
  {
    title: 'Контакты',
    path: '/contacts',
    children: [
      { title: 'Оргкомитет', path: '/contacts' },
      { title: 'Сообщество во «ВКонтакте»', path: 'https://vk.com/lideri.prava2026', external: true },
    ],
  },
] as const;

/**
 * Структура шторки: пять колонок вместо плоского списка ссылок.
 *
 * В верхней панели остаётся только самое важное (знак, личный кабинет, подача
 * заявки), а вся структура раскрывается по нажатию. Колонки сгруппированы по
 * смыслу пути участника: узнать о конкурсе → пройти этапы → подготовить
 * материалы → увидеть результаты → найти документ или связаться.
 */
export interface MenuColumn {
  title: string;
  path: string;
  links: NavChild[];
}

export const MENU_COLUMNS: readonly MenuColumn[] = [
  {
    title: 'О конкурсе',
    path: '/about',
    links: [
      { title: 'Общее описание', path: '/about' },
      { title: 'История конкурса', path: '/about/history' },
      { title: 'Учредитель и партнёры', path: '/about/partners' },
      { title: 'Оргкомитет и эксперты', path: '/about/organizers' },
      { title: 'Положение о конкурсе', path: '/about/regulations' },
      { title: 'Частые вопросы', path: '/about/faq' },
    ],
  },
  {
    title: 'Этапы',
    path: '/stages',
    links: [
      { title: 'Обзор этапов', path: '/stages' },
      { title: 'Отборочный этап', path: '/stages/selection' },
      { title: 'Первый этап', path: '/stages/first' },
      { title: 'Второй (финальный) этап', path: '/stages/final' },
      { title: 'Календарь конкурса', path: '/stages/calendar' },
      { title: 'Критерии оценки', path: '/stages/criteria' },
      { title: 'Апелляции', path: '/stages/appeals' },
    ],
  },
  {
    title: 'Участнику',
    path: '/participants',
    links: [
      { title: 'Как участвовать', path: '/participants' },
      { title: 'Требования к участникам', path: '/participants/requirements' },
      { title: 'Конкурсные материалы', path: '/participants/materials' },
      { title: 'Требования к видеоролику', path: '/participants/video-requirements' },
      { title: 'Подать заявку', path: '/apply' },
    ],
  },
  {
    title: 'Результаты и медиа',
    path: '/initiatives',
    links: [
      { title: 'Архив законопроектов', path: '/initiatives' },
      { title: 'Инициативы по годам', path: '/initiatives#years' },
      { title: 'Победители', path: '/winners' },
      { title: 'Мастер-классы', path: '/masterclasses' },
      { title: 'Записи мастер-классов', path: '/masterclasses/past' },
      { title: 'Новости', path: '/news' },
    ],
  },
  {
    title: 'Документы и связь',
    path: '/documents',
    links: [
      { title: 'Все документы и приложения', path: '/documents' },
      { title: 'Приложения № 1–17', path: '/documents#appendices' },
      { title: 'Положение (PDF)', path: '/about/regulations' },
      { title: 'Оферта', path: '/legal/offer' },
      { title: 'Политика обработки данных', path: '/legal/privacy' },
      { title: 'Контакты оргкомитета', path: '/contacts' },
    ],
  },
] as const;

/** Подвал-карта сайта: каждый раздел и каждая страница. */
export interface FooterGroup {
  title: string;
  links: NavChild[];
}

export const FOOTER_GROUPS: readonly FooterGroup[] = [
  {
    title: 'Конкурс',
    links: [
      { title: 'О конкурсе', path: '/about' },
      { title: 'История конкурса', path: '/about/history' },
      { title: 'Учредитель и партнёры', path: '/about/partners' },
      { title: 'Оргкомитет и эксперты', path: '/about/organizers' },
      { title: 'Положение о конкурсе', path: '/about/regulations' },
      { title: 'Частые вопросы', path: '/about/faq' },
    ],
  },
  {
    title: 'Участие',
    links: [
      { title: 'Как участвовать', path: '/participants' },
      { title: 'Требования к участникам', path: '/participants/requirements' },
      { title: 'Конкурсные материалы', path: '/participants/materials' },
      { title: 'Требования к видеоролику', path: '/participants/video-requirements' },
      { title: 'Отборочный этап', path: '/stages/selection' },
      { title: 'Первый этап', path: '/stages/first' },
      { title: 'Второй (финальный) этап', path: '/stages/final' },
      { title: 'Календарь', path: '/stages/calendar' },
      { title: 'Критерии оценки', path: '/stages/criteria' },
      { title: 'Апелляции', path: '/stages/appeals' },
    ],
  },
  {
    title: 'Результаты и медиа',
    links: [
      { title: 'Архив законопроектов', path: '/initiatives' },
      { title: 'Победители', path: '/winners' },
      { title: 'Новости', path: '/news' },
      { title: 'Мастер-классы', path: '/masterclasses' },
      { title: 'Записи мастер-классов', path: '/masterclasses/past' },
    ],
  },
  {
    title: 'Документы',
    links: [
      { title: 'Документы и приложения', path: '/documents' },
      { title: 'Оферта', path: '/legal/offer' },
      { title: 'Политика обработки данных', path: '/legal/privacy' },
      { title: 'Согласие на обработку данных', path: '/legal/pdn-consent' },
      { title: 'Согласие законного представителя', path: '/legal/pdn-consent-minor' },
      { title: 'Согласие на распространение', path: '/legal/distribution-consent' },
      { title: 'Лицензия на материалы', path: '/legal/media-license' },
      { title: 'Политика cookie', path: '/legal/cookies' },
      { title: 'Пользовательское соглашение', path: '/legal/terms' },
      { title: 'Регламент Жюри', path: '/legal/jury-regulations' },
      // Полное название политики остаётся в юридической строке подвала; в
      // колонке-карте сайта подпись короткая — иначе она рвётся на две строки
      // и колонка выглядит неопрятно на фоне соседних.
    ],
  },
] as const;

/**
 * Порядок чтения сайта — основа кнопок «назад / далее» внизу страницы.
 *
 * Участник идёт по конкурсу последовательно (о конкурсе → этапы → материалы →
 * заявка), поэтому переходы между страницами заданы явно, а не «куда попало».
 */
export const READING_ORDER: readonly { path: string; title: string }[] = [
  { path: '/', title: 'Главная' },
  { path: '/about', title: 'О конкурсе' },
  { path: '/about/history', title: 'История конкурса' },
  { path: '/about/partners', title: 'Учредитель и партнёры' },
  { path: '/about/organizers', title: 'Оргкомитет и эксперты' },
  { path: '/about/regulations', title: 'Положение о конкурсе' },
  { path: '/about/faq', title: 'Частые вопросы' },
  { path: '/stages', title: 'Этапы конкурса' },
  { path: '/stages/selection', title: 'Отборочный этап' },
  { path: '/stages/first', title: 'Первый этап' },
  { path: '/stages/final', title: 'Второй (финальный) этап' },
  { path: '/stages/calendar', title: 'Календарь конкурса' },
  { path: '/stages/criteria', title: 'Критерии оценки' },
  { path: '/stages/appeals', title: 'Апелляции' },
  { path: '/participants', title: 'Как участвовать' },
  { path: '/participants/requirements', title: 'Требования к участникам' },
  { path: '/participants/materials', title: 'Конкурсные материалы' },
  { path: '/participants/video-requirements', title: 'Требования к видеоролику' },
  { path: '/masterclasses', title: 'Мастер-классы' },
  { path: '/masterclasses/past', title: 'Записи мастер-классов' },
  { path: '/initiatives', title: 'Архив законопроектов' },
  { path: '/winners', title: 'Победители' },
  { path: '/news', title: 'Новости' },
  { path: '/documents', title: 'Документы' },
  { path: '/contacts', title: 'Контакты' },
] as const;

/**
 * Соседние страницы в порядке чтения.
 *
 * Для карточек (новость, инициатива, мастер-класс) и служебных экранов
 * возвращаем соседей их раздела — так переходы есть на каждой странице.
 */
export function pageNavFor(pathname: string): {
  prev: { path: string; title: string } | null;
  next: { path: string; title: string } | null;
} {
  const clean = pathname.replace(/\/+$/, '') || '/';
  let index = READING_ORDER.findIndex((item) => item.path === clean);

  // Правовые документы и приложения — часть раздела «Документы».
  if (index === -1 && clean.startsWith('/legal/')) {
    index = READING_ORDER.findIndex((item) => item.path === '/documents');
  }

  if (index === -1) {
    // Карточка внутри раздела: ищем самый длинный подходящий префикс.
    const parent = READING_ORDER.map((item, position) => ({ item, position }))
      .filter(({ item }) => item.path !== '/' && clean.startsWith(`${item.path}/`))
      .sort((a, b) => b.item.path.length - a.item.path.length)[0];
    if (!parent) return { prev: null, next: null };
    index = parent.position;
  }

  return {
    prev: (index > 0 ? READING_ORDER[index - 1] : null) ?? null,
    next: (index < READING_ORDER.length - 1 ? READING_ORDER[index + 1] : null) ?? null,
  };
}

/**
 * Хлебные крошки по адресу: на внутренних страницах (ТЗ 08, п. 1.3.4).
 * Возвращает пустой список для главной — там крошки не нужны.
 *
 * Последний элемент — текущая страница; для карточек и служебных экранов
 * страница сама добавляет подпись через `useTrailLabel`.
 */
export function trailFor(pathname: string): Array<{ title: string; path: string }> {
  if (pathname === '/' || pathname === '') return [];
  const trail: Array<{ title: string; path: string }> = [{ title: 'Главная', path: '/' }];

  const section = NAV_SECTIONS.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`)
  );
  if (!section) return trail;

  trail.push({ title: section.title, path: section.path });
  const child = section.children.find((item) => !item.external && item.path === pathname);
  if (child && child.path !== section.path) {
    trail.push({ title: child.title, path: child.path });
  }
  return trail;
}
