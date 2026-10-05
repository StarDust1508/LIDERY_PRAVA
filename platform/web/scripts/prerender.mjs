#!/usr/bin/env node
// Пререндер публичных маршрутов (ТЗ 08, п. 2.4 и 9).
//
// Зачем это нужно:
//   1. «Честный 404» (ТЗ 08, п. 2.4.2): nginx отдаёт 404 для пути, которого нет
//      в сборке. Без статических файлов на каждый маршрут одностраничное
//      приложение отдало бы 200 и главную страницу на любой адрес.
//   2. Метаданные: заголовок, описание, canonical и Open Graph попадают в HTML
//      сразу, а не после исполнения скриптов, — их видят поисковые системы и
//      предпросмотр ссылок в мессенджерах.
//   3. Скорость: первая отрисовка не ждёт загрузки бандла.
//
// Что здесь НЕ делается: серверный рендер данных. Блоки, которые берут сроки,
// критерии и документы из базы, отрисовываются в браузере: сроки меняются
// решением Оргкомитета, и держать их копию в статике нельзя. Скрипт собирает
// разметку оболочки и метаданные маршрута; тексты страниц приходят с API.
//
// Запуск: node scripts/prerender.mjs (вызывается из npm run build)

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '../dist');
const BASE_URL = 'https://lideryprava.ru';
const ORGANIZATION = 'Межрегиональная общественная организация выпускников Саратовской государственной юридической академии «Ассоциация выпускников СЮИ – СГАП – СГЮА»';

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('Пререндер: не найден dist/index.html — сначала выполните vite build.');
  process.exit(1);
}

/**
 * Маршруты публичной части: путь, заголовок, описание и служебные флаги.
 * Соответствует карте ТЗ 08, п. 2.1.
 */
const ROUTES = [
  { path: '/', title: 'Конкурс «Лидеры права – 2027»', description: 'Десятый ежегодный федеральный научно-образовательный конкурс среди студентов и молодых специалистов: этапы, сроки, мастер-классы, архив законопроектов и победители.' },
  { path: '/about', title: 'О конкурсе', description: 'О конкурсе «Лидеры права – 2027»: цели, учредитель, порядок проведения и ответы на частые вопросы.' },
  { path: '/about/partners', title: 'Партнёры конкурса', description: 'Учредитель и партнёры конкурса «Лидеры права – 2027».' },
  { path: '/about/history', title: 'История конкурса', description: 'История конкурса «Лидеры права»: сезоны, победители и развитие проекта с 2017 года.' },
  { path: '/about/organizers', title: 'Оргкомитет и эксперты', description: 'Оргкомитет, Конкурсная комиссия, Жюри и эксперты конкурса «Лидеры права – 2027».' },
  { path: '/about/regulations', title: 'Положение о конкурсе', description: 'Положение о конкурсе «Лидеры права – 2027» и Приложения № 1–14: просмотр и скачивание.' },
  { path: '/about/faq', title: 'Частые вопросы', description: 'Ответы на частые вопросы об участии в конкурсе «Лидеры права – 2027».' },
  { path: '/stages', title: 'Этапы конкурса', description: 'Отборочный, первый и второй (финальный) этапы конкурса «Лидеры права – 2027»: форматы, сроки и критерии.' },
  { path: '/stages/selection', title: 'Отборочный этап', description: 'Отборочный этап конкурса «Лидеры права – 2027»: сроки, конкурсные материалы и критерии оценки.' },
  { path: '/stages/first', title: 'Первый этап', description: 'Первый этап конкурса «Лидеры права – 2027»: видеоролики, оценка материалов и протокол итогов.' },
  { path: '/stages/final', title: 'Второй (финальный) этап', description: 'Второй (финальный) этап конкурса «Лидеры права – 2027»: групповые выступления, дебаты и Гранд-финал.' },
  { path: '/stages/calendar', title: 'Календарь конкурса', description: 'Календарный план конкурса «Лидеры права – 2027» по московскому времени.' },
  { path: '/stages/criteria', title: 'Критерии оценки', description: 'Критерии оценки конкурсных материалов по этапам и правила подсчёта баллов.' },
  { path: '/stages/appeals', title: 'Апелляции', description: 'Порядок и сроки подачи апелляций по итогам этапов конкурса «Лидеры права – 2027».' },
  { path: '/participants', title: 'Как участвовать', description: 'Как принять участие в конкурсе «Лидеры права – 2027»: шаги, сроки и требования.' },
  { path: '/participants/requirements', title: 'Требования к участникам', description: 'Кто может участвовать в конкурсе «Лидеры права – 2027»: возраст, состав команды и наставники.' },
  { path: '/participants/materials', title: 'Конкурсные материалы', description: 'Состав конкурсных материалов по этапам и требования к файлам.' },
  { path: '/participants/video-requirements', title: 'Требования к видеоролику', description: 'Требования к видеоролику первого этапа конкурса «Лидеры права – 2027».' },
  { path: '/initiatives', title: 'Архив законопроектов', description: 'Архив законотворческих инициатив конкурса «Лидеры права»: поиск по годам и направлениям.' },
  { path: '/masterclasses', title: 'Мастер-классы', description: 'Анонсы мастер-классов для команд-финалистов конкурса «Лидеры права – 2027».' },
  { path: '/masterclasses/past', title: 'Записи мастер-классов', description: 'Записи прошедших мастер-классов конкурса «Лидеры права – 2027».' },
  { path: '/news', title: 'Новости и видео', description: 'Новости конкурса «Лидеры права – 2027» и видеосюжеты о проекте.' },
  { path: '/winners', title: 'Победители', description: 'Победители конкурса «Лидеры права» по годам и номинациям.' },
  { path: '/documents', title: 'Документы', description: 'Положение о конкурсе, Приложения № 1–14 и юридические документы редакции 04.10.2026.' },
  { path: '/contacts', title: 'Контакты Оргкомитета', description: 'Контакты Оргкомитета конкурса «Лидеры права – 2027» и форма обращения.' },
  { path: '/legal/offer', title: 'Оферта', description: 'Оферта сайта конкурса «Лидеры права – 2027».' },
  { path: '/legal/privacy', title: 'Обработка персональных данных', description: 'Политика в отношении обработки персональных данных конкурса «Лидеры права – 2027».' },
  { path: '/legal/pdn-consent', title: 'Согласие на обработку персональных данных', description: 'Форма согласия на обработку персональных данных (Приложение № 10).' },
  { path: '/legal/pdn-consent-minor', title: 'Согласие законного представителя', description: 'Форма согласия законного представителя участника младше 18 лет (Приложение № 11).' },
  { path: '/legal/distribution-consent', title: 'Согласие на распространение персональных данных', description: 'Форма согласия на распространение персональных данных по категориям (Приложение № 12).' },
  { path: '/legal/media-license', title: 'Лицензия на конкурсные материалы', description: 'Согласие на использование изображения и лицензия на конкурсные материалы (Приложение № 13).' },
  { path: '/legal/cookies', title: 'Использование cookie', description: 'Политика использования cookie-файлов на сайте конкурса «Лидеры права – 2027».' },
  { path: '/legal/terms', title: 'Пользовательское соглашение', description: 'Пользовательское соглашение сайта конкурса «Лидеры права – 2027».' },
  { path: '/legal/jury-regulations', title: 'Регламент Жюри', description: 'Регламент Жюри и урегулирования конфликта интересов конкурса «Лидеры права – 2027».' },
  { path: '/legal/mailing-consent', title: 'Согласие на информационные сообщения', description: 'Согласие на получение информационных и новостных сообщений о конкурсе.' },
  { path: '/legal/appendix/1', title: 'Приложение № 1', description: 'Форма заявки на участие в конкурсе «Лидеры права – 2027».' },
  // Служебные экраны: собираются статикой, но не индексируются.
  { path: '/apply', title: 'Подать заявку', description: 'Электронная форма подачи заявки на конкурс «Лидеры права – 2027».', noindex: true },
  { path: '/cabinet', title: 'Личный кабинет', description: 'Личный кабинет команды конкурса «Лидеры права – 2027».', noindex: true },
  { path: '/cabinet/access', title: 'Вход в личный кабинет', description: 'Вход в личный кабинет команды по ссылке доступа или номеру заявки.', noindex: true },
  { path: '/cabinet/team', title: 'Команда', description: 'Состав команды в личном кабинете конкурса.', noindex: true },
  { path: '/cabinet/materials', title: 'Конкурсные материалы', description: 'Конкурсные материалы команды в личном кабинете.', noindex: true },
  { path: '/cabinet/deadlines', title: 'Дедлайны', description: 'Сроки этапов в личном кабинете команды.', noindex: true },
  { path: '/cabinet/help', title: 'Помощь', description: 'Связь с Оргкомитетом из личного кабинета.', noindex: true },
  { path: '/cabinet/final', title: 'Финал', description: 'Подтверждение участия в финальном этапе.', noindex: true },
];

/** Разметка организации для главной и «О конкурсе». */
const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: ORGANIZATION,
  alternateName: 'Ассоциация выпускников СЮИ – СГАП – СГЮА',
  url: BASE_URL,
  email: 'ssla_av@mail.ru',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'ул. Мясницкая, д. 48',
    addressLocality: 'Москва',
    postalCode: '107078',
    addressCountry: 'RU',
  },
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function breadcrumbJsonLd(route) {
  const parts = route.path.split('/').filter(Boolean);
  const items = [{ name: 'Главная', path: '/' }];
  let accumulated = '';
  for (const part of parts) {
    accumulated += `/${part}`;
    items.push({ name: part, path: accumulated });
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${BASE_URL}${item.path}`,
    })),
  };
}

/** Подставляет в оболочку метаданные маршрута. */
function renderRoute(shell, route) {
  const url = `${BASE_URL}${route.path === '/' ? '/' : route.path}`;
  const fullTitle = route.path === '/' ? route.title : `${route.title} · Лидеры права – 2027`;
  const robots = route.noindex ? 'noindex, nofollow' : 'index, follow';

  const extra = [];
  if (route.path === '/' || route.path === '/about') {
    extra.push(`<script type="application/ld+json">${JSON.stringify(ORGANIZATION_JSON_LD)}</script>`);
  }
  if (!route.noindex && route.path !== '/') {
    extra.push(`<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd(route))}</script>`);
  }

  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(fullTitle)}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escapeHtml(route.description)}">`
    )
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escapeHtml(fullTitle)}">`)
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escapeHtml(route.description)}">`
    )
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`)
    .replace('</head>', `  <meta name="robots" content="${robots}">\n${extra.map((line) => `  ${line}`).join('\n')}\n</head>`);
}

const shell = readFileSync(join(distDir, 'index.html'), 'utf8');
let written = 0;

for (const route of ROUTES) {
  const html = renderRoute(shell, route);
  if (route.path === '/') {
    writeFileSync(join(distDir, 'index.html'), html, 'utf8');
    written += 1;
    continue;
  }
  const targetDir = join(distDir, route.path.replace(/^\//, ''));
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'index.html'), html, 'utf8');
  written += 1;
}

// Страница 404: nginx отдаёт её с кодом 404 на неизвестный путь (ТЗ 08, п. 2.4.2).
const notFound = renderRoute(shell, {
  path: '/404',
  title: 'Страница не найдена',
  description: 'Запрошенная страница не найдена. Вернитесь на главную или воспользуйтесь разделами сайта.',
  noindex: true,
}).replace('</head>', '  <meta name="robots" content="noindex, nofollow">\n</head>');
writeFileSync(join(distDir, '404.html'), notFound, 'utf8');

// Проверка: без статики на маршрутах конфигурация nginx отдаст 404 вместо
// страницы, поэтому сборка должна падать, если файлы не созданы.
const missing = ROUTES.filter((route) => route.path !== '/').filter(
  (route) => !existsSync(join(distDir, route.path.replace(/^\//, ''), 'index.html'))
);
if (missing.length > 0) {
  console.error(`Пререндер: не созданы файлы для маршрутов: ${missing.map((item) => item.path).join(', ')}`);
  process.exit(1);
}

console.log(`Пререндер: собрано страниц — ${written}, страница 404 — dist/404.html`);
