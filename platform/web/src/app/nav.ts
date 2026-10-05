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
      { title: 'Приложения № 1–14', path: '/documents#appendices' },
      { title: 'Оферта', path: '/legal/offer' },
      { title: 'Политика обработки персональных данных', path: '/legal/privacy' },
      { title: 'Согласие на обработку персональных данных', path: '/legal/pdn-consent' },
      { title: 'Согласие законного представителя', path: '/legal/pdn-consent-minor' },
      { title: 'Согласие на распространение', path: '/legal/distribution-consent' },
      { title: 'Лицензия на материалы', path: '/legal/media-license' },
      { title: 'Политика cookie', path: '/legal/cookies' },
      { title: 'Пользовательское соглашение', path: '/legal/terms' },
      { title: 'Регламент Жюри', path: '/legal/jury-regulations' },
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
