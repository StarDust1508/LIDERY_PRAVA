# Карта страниц, кабинета и админ-панели

Документ для приёмки: все адреса платформы «Лидеры права – 2027», что на каждой
странице, где лежит исходный код и как войти в админ-панель.

- Сайт: **https://lideryprava.ru**
- Админ-панель: **https://lideryprava.ru/admin/**
- API: `https://lideryprava.ru/api/*` (systemd-юнит `liders-api`, порт 8100)
- Проверка живости: `https://lideryprava.ru/api/health`

## 1. Доступ в админ-панель

| Что | Значение |
|---|---|
| Адрес входа | `https://lideryprava.ru/admin/` |
| Логин | `admin` |
| Пароль | `fODNP4s2NIX7DN2acfWC` |
| Роль | администратор: видит все разделы, включая архив 2026, импорт, страницы сайта, критерии, сезоны, экспертов, жюри, настройки, права субъектов ПДн, пользователей и журнал действий |
| Где хранятся доступы на сервере | `/etc/lideryprava/credentials.txt` (логин и пароль админки, пароль БД), `/etc/lideryprava/api.env` (окружение API) |
| Смена своего пароля | админка → «Пользователи» → «Сменить пароль» (страница `PasswordChangePage`), либо смена пароля другому пользователю в его карточке |

Проверено 10 октября 2026: `POST /api/admin/login` с этими данными отвечает
`200` и выдаёт токен.

> Пароль показан в этом файле по запросу владельца. После приёмки его стоит
> сменить: «Пользователи» → своя учётная запись → «Сменить пароль».

## 2. Публичные страницы сайта

Все адреса отдают `200` (проверено на проде), у каждой страницы свой заголовок,
описание и микроразметка. Исходники — `platform/web/src/pages/`.

### О конкурсе

| Адрес | Страница | Файл |
|---|---|---|
| `/` | Главная: первый экран, шкала 2017–2027, этапы, что получают участники, партнёры, мастер-классы, вопросы и ответы, подача заявки | `HomePage.tsx` |
| `/about` | О конкурсе: цели, органы, регламент | `AboutPage.tsx` |
| `/about/history` | История конкурса: сезоны 2017–2026 | `HistoryPage.tsx` |
| `/about/partners` | Учредитель и партнёры | `PartnersPage.tsx` |
| `/about/organizers` | Оргкомитет и эксперты: шесть органов конкурса | `OrganizersPage.tsx` |
| `/about/regulations` | Положение о конкурсе: версии, приложения, порядок | `RegulationsPage.tsx` |
| `/about/faq` | Частые вопросы | `FaqPage.tsx` |

### Этапы

| Адрес | Страница | Файл |
|---|---|---|
| `/stages` | Этапы конкурса: три этапа, критерии по этапам, апелляции | `StagesPage.tsx` |
| `/stages/selection` | Отборочный этап: сроки, порядок, критерии | `StageSelectionPage.tsx` |
| `/stages/first` | Первый этап: видеопрезентация, публикация во «ВКонтакте», критерии | `StageFirstPage.tsx` |
| `/stages/final` | Второй (финальный) этап: дебаты, Гранд-финал, голосование зала | `StageFinalPage.tsx` |
| `/stages/calendar` | Календарь этапов: все даты по московскому времени | `CalendarPage.tsx` |
| `/stages/criteria` | Критерии оценки по этапам и правила подсчёта | `CriteriaPage.tsx` |
| `/stages/appeals` | Апелляции: сроки, основания, порядок подачи | `AppealsPage.tsx` |

### Участнику

| Адрес | Страница | Файл |
|---|---|---|
| `/participants` | Как участвовать: маршрут участника | `ParticipantsPage.tsx` |
| `/participants/requirements` | Требования к участникам: возраст, состав команды, наставники | `RequirementsPage.tsx` |
| `/participants/materials` | Конкурсные материалы: состав комплекта, требования к файлам | `MaterialsPage.tsx` |
| `/participants/video-requirements` | Требования к видеоролику: содержание, формат, публикация | `VideoRequirementsPage.tsx` |
| `/apply` | Мастер подачи заявки: 5 шагов (команда и инициатива → участники и наставники → материалы → согласия → проверка) | `ApplyPage.tsx` |

### Результаты, медиа, документы

| Адрес | Страница | Файл |
|---|---|---|
| `/initiatives` | Архив законопроектов с поиском и фильтрами по годам | `InitiativesPage.tsx` |
| `/initiatives/:slug` | Карточка инициативы | `InitiativePage.tsx` |
| `/winners`, `/winners/:год` | Победители по годам и номинациям | `WinnersPage.tsx` |
| `/news`, `/news/:slug` | Новости и видеосюжеты | `NewsPage.tsx`, `NewsItemPage.tsx` |
| `/masterclasses` | Мастер-классы: анонсы и фильтры | `MasterclassesPage.tsx` |
| `/masterclasses/past` | Записи прошедших мастер-классов | `MasterclassesPastPage.tsx` |
| `/masterclasses/:slug` | Карточка мастер-класса | `MasterclassPage.tsx` |
| `/documents` | Документы конкурса: Положение, Приложения № 1–14, юридические документы | `DocumentsPage.tsx` |
| `/contacts` | Контакты оргкомитета | `ContactsPage.tsx` |
| `/legal/appendix/:номер` | Отдельное приложение к Положению | `AppendixPage.tsx` |
| `/legal/offer`, `/legal/privacy`, `/legal/terms`, `/legal/cookies`, `/legal/pdn-consent`, `/legal/pdn-consent-minor`, `/legal/distribution-consent`, `/legal/media-license`, `/legal/jury-regulations` | Юридические документы (оферта, политика ПДн, согласия, лицензия, регламент Жюри) | `LegalPage.tsx` |
| `/404` | Страница «не найдено» | `NotFoundPage.tsx` |

## 3. Личный кабинет команды

Вход — по ссылке доступа, которая приходит на почту капитана после допуска
заявки (страница `/cabinet/access`). Исходники — `platform/web/src/pages/Cabinet*.tsx`,
маршруты — `platform/web/src/app/App.tsx`.

| Адрес | Что внутри | Файл |
|---|---|---|
| `/cabinet/access` | Вход по ссылке доступа из письма | `CabinetAccessPage.tsx` |
| `/cabinet` | Обзор: статус заявки, шаги, сроки, уведомления | `CabinetPage.tsx` |
| `/cabinet/team` | Команда: состав, капитан, наставники, замена участника | `CabinetTeamPage.tsx` |
| `/cabinet/materials` | Конкурсные материалы: загрузка файлов, ссылка на видеоролик, статусы проверки | `CabinetMaterialsPage.tsx` |
| `/cabinet/deadlines` | Сроки этапов и напоминания | `CabinetDeadlinesPage.tsx` |
| `/cabinet/help` | Помощь: частые вопросы кабинета, связь с оргкомитетом | `CabinetHelpPage.tsx` |
| `/cabinet/final` | Кабинет финалиста: подтверждение участия и презентационные материалы | `CabinetFinalPage.tsx` |
| `/cabinet` → «Апелляции» | Подача и отслеживание апелляций капитаном | `CabinetActions.tsx` |
| `/expert`, `/expert/access` | Кабинет эксперта: доступ по ссылке, оценки по критериям | `ExpertPage.tsx` |

## 4. Админ-панель

Адрес: `https://lideryprava.ru/admin/`. Меню — четыре группы; пункты с пометкой
«только администратор» не видны оператору. Исходники — `platform/admin/src/pages/`,
маршруты и меню — `platform/admin/src/app/App.tsx`.

### Работа с конкурсом

| Раздел | Адрес | Что делает | Файл |
|---|---|---|---|
| Сводка | `/admin/` | Счётчики по заявкам, материалам, командам, обращениям; команды по этапам и направлениям; выгрузка сводки в CSV | `DashboardPage.tsx` |
| Заявки | `/admin/applications` | Список заявок: фильтры, сортировка по колонкам, капитан и комплект материалов, выгрузка всей выборки (CSV/XLSX) | `ApplicationsPage.tsx` |
| Карточка заявки | `/admin/applications/:id` | Техническая проверка, проверка требований, согласия, история, карточка команды, материалы, допуск и отказ | `ApplicationPage.tsx` |
| Материалы | `/admin/materials` | Комплекты команд, поиск, блокировка файла с причиной, группировка по заявке, выгрузка | `MaterialsPage.tsx` |
| Команды | `/admin/teams` | Карточка команды: реквизиты, участники, наставники, направление, переходы по этапам | `TeamsPage.tsx` |
| Оценки | `/admin/evaluation`, `/admin/evaluation/:teamId` | Матрица «команда × эксперт», конфликты интересов, сводка баллов | `EvaluationPage.tsx` |
| Рейтинг | `/admin/rankings` | Итоги этапа, протокол, публикация рейтинга и итогов | `RankingsPage.tsx` |
| Апелляции | `/admin/appeals` | Апелляции: сроки, фильтр по сезону, сканы, решения комиссии | `AppealsPage.tsx` |
| Обращения | `/admin/leads` | Обращения и вопросы с сайта, шаблоны ответов | `LeadsPage.tsx` |

### Контент

| Раздел | Адрес | Файл |
|---|---|---|
| Мастер-классы | `/admin/masterclasses` | `ResourceScreen` (общий экран справочника) |
| Новости | `/admin/news` | `ResourceScreen` |
| Документы | `/admin/documents` | `ResourceScreen` (файлы и внешние ссылки, версии и даты редакций) |
| Победители | `/admin/winners` | `ResourceScreen` |
| Архив законопроектов | `/admin/initiatives` | `ResourceScreen` |
| Авторы инициатив | `/admin/initiative-authors` | `InitiativeAuthorsPage.tsx` |
| Импорт архива (только администратор) | `/admin/initiatives-import` | `InitiativesImportPage.tsx` |
| Страницы сайта (только администратор) | `/admin/pages` | `ResourceScreen` |
| Партнёры | `/admin/partners` | `ResourceScreen` |
| Заявки 2026, архив (только администратор) | `/admin/legacy-applications` | `ResourceScreen` |

### Настройка конкурса (только администратор)

| Раздел | Адрес | Файл |
|---|---|---|
| Сезоны | `/admin/seasons` | `ResourceScreen` |
| Направления | `/admin/directions` | `ResourceScreen` |
| Критерии оценки | `/admin/criteria` | `ResourceScreen` |
| Эксперты | `/admin/experts` | `ResourceScreen` |
| Жюри | `/admin/jury-members` | `ResourceScreen` |
| Настройки | `/admin/settings` | `SettingsPage.tsx` (редакторы по типу значения, ревизия и автор правки, включатели разделов) |
| Права субъектов ПДн | `/admin/subjects` | `SubjectsPage.tsx` (обращения субъектов, основания, канал и дата получения, согласия, распределение, материалы, обезличивание) |
| Пользователи | `/admin/users` | `UsersPage.tsx` (роли, блокировка с причиной, смена пароля, счётчик администраторов) |
| **Журнал действий** | `/admin/audit` | `AuditPage.tsx` — см. раздел 5 |

## 5. Журнал действий (лог админ-панели)

Это и есть «лог» платформы: каждая успешная правка через админку записывается
middleware `auditAdminMutations` (`platform/server/src/lib/audit.ts`), запись
хранится в таблице `liders.audit_log`.

| Что | Где |
|---|---|
| Страница | `https://lideryprava.ru/admin/audit` |
| Код страницы | `platform/admin/src/pages/AuditPage.tsx` |
| API списка | `GET /api/admin/audit` — `platform/server/src/routes/admin.ts`, строка ~4378 |
| API выгрузки | `GET /api/admin/audit/export` — CSV со всей выборкой (строка ~3491) |
| Таблица | `liders.audit_log` (кто, когда, действие, сущность, идентификатор, было/стало, IP, user-agent) |
| Фильтры | действие, поиск по тексту, пользователь, сущность, период (включительно по дату) |
| Страницы | постраничный вывод, размер страницы переключается |
| Значимые действия | подсвечиваются точкой и поясняются в фильтре: блокировки, отказы, обезличивание и выгрузка ПДн, смена паролей и ролей, снятие протокола, выгрузки |
| Словарь | `ACTION_TITLES` в `AuditPage.tsx` — коды действий переведены на русский («Заявка изменена», «Настройка изменена» и т. д.) |

Что попадает в журнал: публикация и снятие протокола, решения по заявкам
(допуск, отказ, возврат), проверка требований, решения по апелляциям, правки
справочников и настроек, действия с пользователями и ролями, обращения субъектов
ПДн, выгрузки и массовые операции.

## 6. Где что лежит в коде

```
platform/
  server/     API: Express + TypeScript (маршруты — src/routes/, миграции — ../migrations/)
  web/        публичная часть и личный кабинет: React + Vite (src/pages/, src/app/App.tsx, src/styles/)
  admin/      админ-панель: React + Vite (src/pages/, src/app/App.tsx)
  shared/     общие типы, клиент API и UI-компоненты (src/types.ts, src/adminApi.ts, src/ui.tsx)
  migrations/ SQL-миграции (нумерованные, применяются при выкате)
  scripts/    acceptance.sh (приёмочный прогон), check-decoupling.sh (гейты Г1–Г7)
  ACCEPTANCE.md  протокол приёмки: что и как проверено
ops/
  deploy.sh   выкат на прод
  README.md   журнал выкатов
tools/
  check-workspace-source.mjs  предохранитель источника выпуска
```

## 7. Служебные адреса

| Адрес | Назначение |
|---|---|
| `/api/health` | состояние API и БД |
| `/api/season/current` | активный сезон и сроки |
| `/api/documents` | опубликованные документы |
| `/api/criteria?stage=...` | критерии этапа |
| `/api/admin/login` | вход в админ-панель (POST, логин и пароль) |
| `/api/cabinet/...` | методы личного кабинета (по токену доступа) |
