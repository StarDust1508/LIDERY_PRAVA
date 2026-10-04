# Платформа конкурса «Лидеры права» — бэкенд

Стартовая кодовая база самостоятельного проекта для официального сайта конкурса
**«Лидеры права – 2027»** (домен по умолчанию — `lideryprava.ru`).

Это не форк и не копия другого продукта: доменной логики, брендинга и ключей
настроек посторонних проектов здесь нет. Из проверенной архитектуры перенесены
только общие приёмы — пул `pg` с `search_path`, мигратор с advisory-lock,
stateless HMAC-сессии администратора, хранение файлов в PostgreSQL (BYTEA) с
проверкой magic-байтов и собственный in-memory rate-limit.

## Что внутри

```
platform/
├── migrations/          только SQL, нумерация 001…010 без пропусков
│   ├── 001_core.sql                 пользователи, media (BYTEA), журналы, настройки, обращения
│   ├── 002_seasons_directions.sql   сезон конкурса и направления (Приложение № 2)
│   ├── 003_teams_participants_mentors.sql
│   ├── 004_applications_materials.sql
│   ├── 005_access_tokens_log.sql    токены личного кабинета и журнал входов
│   ├── 006_commission.sql           эксперты, Жюри, критерии
│   ├── 007_evaluations_rankings.sql
│   ├── 008_appeals.sql
│   ├── 009_content.sql              мастер-классы, партнёры, новости, документы
│   └── 010_reference_data.sql       сезон 2027, направления, критерии, настройки
├── server/
│   ├── .env.example     только реально читаемые переменные
│   ├── package.json     Express 4 + TypeScript (ESM), tsx для dev, tsc для сборки
│   ├── tsconfig.json    NodeNext, strict
│   └── src/
│       ├── index.ts             точка входа, порядок middleware, health, обработчик ошибок
│       ├── config.ts            проверка обязательных переменных окружения
│       ├── db.ts                пул pg + search_path в единственной схеме `liders`
│       ├── migrate.ts           мигратор: advisory-lock, таблица _migrations, --seed
│       ├── middleware/
│       │   ├── admin-auth.ts      HMAC-токен админ-сессии, отзыв, requireAdmin
│       │   ├── team-auth.ts       токен доступа команды, журнал входов, requireTeam
│       │   ├── rate-limit.ts      in-memory rate-limit
│       │   └── security-headers.ts
│       ├── lib/                 время по Москве, magic-байты, валидация, CSV, подписанные ссылки
│       └── routes/
│           ├── public.ts        сезон, направления, партнёры, мастер-классы, новости, документы
│           ├── leads.ts         приём обращений
│           ├── media.ts         загрузка и отдача файлов
│           ├── cabinet.ts       личный кабинет команды
│           ├── auth-admin.ts    вход/выход/проверка админ-сессии
│           └── admin.ts         админ-API: заявки, команды, оценки, рейтинг, контент
└── .gitignore
```

## Требования

- Node.js 20 или новее
- PostgreSQL 14 или новее (используется `gen_random_uuid()`, встроенный с PG 13)

## Быстрый старт

```bash
# 1. База данных и схема (схема `liders` создаётся миграциями)
createdb -h 127.0.0.1 -U postgres liders
# либо: psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE liders"

# 2. Переменные окружения
cd platform/server
cp .env.example ../.env        # заполните секреты: JWT_SECRET, ADMIN_SESSION_SECRET, ADMIN_PASSWORD
# при необходимости: cp .env.example .env   (локальное переопределение в каталоге server)

# 3. Зависимости
npm install

# 4. Схема БД
npm run migrate                # применяет migrations/001…010
# npm run migrate -- --seed    # дополнительно применяет файлы со словом «seed» в имени

# 5. Разработка / продакшен
npm run dev                    # tsx watch src/index.ts
npm run build && npm start     # сборка tsc → node dist/index.js

# 6. Проверка типов
npx tsc --noEmit
```

По умолчанию API слушает `http://127.0.0.1:3001`. Приложение намеренно не
слушает `0.0.0.0`: публичный вход — только через nginx с HTTPS.
Проверка живости: `GET /api/health`.

> Если `npm install` падает с `EPERM` на глобальном кэше (`~/.npm`), используйте
> локальный кэш: `npm install --cache ./.npm-cache`.

## Переменные окружения

Обязательные (процесс падает с понятной ошибкой, если их нет):
`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`,
`DATABASE_PASSWORD`, `JWT_SECRET` (≥ 32 символов), `ADMIN_SESSION_SECRET`
(≥ 32 символов), `ADMIN_PASSWORD` (≥ 8 символов).

Остальные: `NODE_ENV`, `API_HOST`, `API_PORT`, `DATABASE_SCHEMA` (по умолчанию
`liders`), `JWT_EXPIRES_IN`, `ADMIN_SESSION_TTL_HOURS`, `ADMIN_LOGIN`,
`MAX_FILE_SIZE`, `MEDIA_PUBLIC_CACHE_SECONDS`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`,
`CSP_MODE`, `CSP_EXTRA_ORIGINS`. Значений вида «чужой домен», «чужая база» или
«чужой пользователь» в коде нет — секреты приходят только из окружения.

## База данных

Одна схема — `liders`. Все таблицы создаются в ней явно (`CREATE TABLE
liders.…`), `search_path` выставляется на каждом соединении в `db.ts`.
Второй схемы в базе нет.

Ключевые таблицы:

| Блок | Таблицы |
|---|---|
| Ядро | `users`, `media`, `admin_session_revocations`, `auth_log`, `site_settings`, `site_settings_revisions`, `leads` |
| Конкурс | `seasons`, `directions`, `teams`, `participants`, `mentors` |
| Заявки | `applications`, `application_materials` |
| Доступ | `access_tokens`, `access_log` |
| Оценка | `experts`, `jury_members`, `criteria`, `evaluations`, `rankings`, `appeals` |
| Контент | `masterclasses`, `partners`, `news`, `documents` |

`rankings` и `evaluations` реализуют пункт 7.7 Положения: итоговый балл —
среднее арифметическое суммарных баллов членов комиссии с округлением до сотых;
при расхождении сумм более чем на 20 баллов ставится пометка
`needs_chair_review` («требуется дополнительная оценка председателя»), и балл
председателя (`is_chair_extra`) учитывается в среднем.

## API

Префикс — `/api`. Публичные маршруты не требуют авторизации; личный кабинет
работает по токену команды, админка — по HMAC-токену админ-сессии.

### Публичные

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | живость и доступность БД |
| GET | `/api/season/current` | активный сезон и настройки сайта |
| GET | `/api/directions` | направления конкурса |
| GET | `/api/partners` | партнёры и спонсоры |
| GET | `/api/masterclasses` | мастер-классы |
| GET | `/api/news`, `/api/news/:slug` | новости и видеосюжеты |
| GET | `/api/documents`, `/api/documents/:id` | Положение и юридические документы |
| GET | `/api/media/file/:id` | файл: публичный — всем, приватный — по токену |
| POST | `/api/leads` | обращение на сайте |

### Личный кабинет (токен команды: `Authorization: Bearer <токен>` или `X-Team-Token`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/cabinet/team` | команда, состав, наставники |
| PATCH | `/api/cabinet/team` | изменение состава до дедлайна |
| GET | `/api/cabinet/materials` | материалы заявки |
| POST | `/api/cabinet/materials` | загрузка файла (multipart) или ссылки |
| DELETE | `/api/cabinet/materials/:id` | удаление материала до дедлайна |
| GET | `/api/cabinet/deadlines` | сроки этапов и сроки досдачи |
| POST | `/api/cabinet/contact` | связь с оргкомитетом, в том числе после дедлайна |
| GET | `/api/cabinet/appeals` | апелляции команды |

### Админка

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/admin/login` | вход, выдаёт токен |
| POST | `/api/admin/logout` | отзыв токена |
| GET | `/api/admin/verify` | проверка сессии |
| GET | `/api/admin/applications` | заявки: фильтры, статусы, пагинация |
| GET | `/api/admin/applications/export` | выгрузка CSV |
| GET/PATCH | `/api/admin/applications/:id` | заявка целиком / техпроверка |
| GET | `/api/admin/materials` | материалы по фильтрам |
| POST | `/api/admin/materials/:id/review` | приёмка, возврат на доработку (п. 7.5), отказ |
| GET | `/api/admin/teams`, `/api/admin/teams/:id` | команды |
| PATCH | `/api/admin/teams/:id` | статус команды, дисквалификация |
| POST/GET | `/api/admin/teams/:id/tokens` | выпуск и список токенов доступа |
| POST | `/api/admin/tokens/:id/revoke` | отзыв токена |
| GET/PATCH | `/api/admin/participants[/:id]` | участники, согласия |
| GET/POST/DELETE | `/api/admin/evaluations` | оценки по критериям |
| GET | `/api/admin/rankings` | рейтинг этапа |
| POST | `/api/admin/rankings/recalculate` | расчёт среднего по п. 7.7 и сортировка |
| POST | `/api/admin/rankings/publish` | публикация протокола |
| PATCH | `/api/admin/rankings/:id` | отметка публикации, примечание |
| GET/POST/PATCH | `/api/admin/appeals` | апелляции и решения |
| GET/PATCH | `/api/admin/leads[/:id]` | обращения |
| GET/PUT/DELETE | `/api/admin/settings[/:key]` | настройки и ревизии |
| GET | `/api/admin/settings/:key/revisions` | история изменений настройки |
| GET | `/api/admin/stats` | сводка для панели |
| GET/POST | `/api/admin/media` | список и загрузка файлов |
| DELETE | `/api/admin/media/:id` | удаление файла |
| CRUD | `/api/admin/seasons`, `/directions`, `/experts`, `/jury-members`, `/criteria`, `/masterclasses`, `/partners`, `/news`, `/documents` | справочники и контент |

## Правила предметной области

- **Дедлайны проверяются на сервере.** Все сроки хранятся как `TIMESTAMPTZ` и
  заданы по московскому времени (UTC+3, `lib/moscow-time.ts`), окончание срока —
  23:59 последнего дня (п. 6.2 Положения). После дедлайна запись материалов
  запрещена (403), доступна только заявка на связь с организаторами
  (`POST /api/cabinet/contact`).
- **Персональные данные не публичны.** Материалы команд выдаются только по
  токену команды, админ-сессии или краткосрочной подписанной ссылке; для
  посторонних приватный файл отвечает `404`.
- **Состав и наставники.** 1–4 участника и ровно один капитан (п. 4.3),
  не более двух наставников (п. 4.9), возраст 16–35 лет (п. 4.1), для
  несовершеннолетних — согласие законного представителя (п. 4.8), один
  участник — одна команда в сезоне (п. 4.4).
- **Загрузка файлов.** MIME-whitelist плюс проверка magic-байтов
  (`lib/media-content.ts`); лимит размера — из `MAX_FILE_SIZE`.
- **Аутентификация.** Админ — stateless HMAC-токен (`v3.<payload>.<sig>`,
  аудитория `liders-admin`) с таблицей отзыва сессий; команда — случайный токен,
  в БД хранится только его SHA-256, есть срок и лимит использований.
- **Фоновых заданий в `app.listen` нет**, маршрутов `/internal/*` нет.

## Доменные значения по умолчанию

- Домен: `lideryprava.ru` (в `PUBLIC_BASE_URL` и настройке `site.domain`).
- Организация-учредитель: «Межрегиональная общественная организация выпускников
  Саратовской государственной юридической академии „Ассоциация выпускников
  СЮИ-СГАП-СГЮА“» (настройка `site.founder_organization`).
- Контакты (e-mail, телефон, ссылка на форму) в коде не хранятся: они задаются
  через настройки сайта в админ-панели.

## Именование полей в API админки

Универсальные CRUD-маршруты (`/api/admin/seasons`, `/directions`, `/experts`,
`/jury-members`, `/criteria`, `/masterclasses`, `/partners`, `/news`,
`/documents`) принимают и возвращают **те же имена полей, что и в базе**
(нижний регистр с подчёркиванием): `recording_url`, `sort_order`, `is_active`,
`partner_type`, `logo_media_id`, `speaker_info`. Тело запроса — JSON.
Список допустимых полей для каждого ресурса задан статически в `routes/admin.ts`
(произвольные поля не принимаются, динамический SQL из внешних данных
невозможен).

Пример:

```bash
curl -X POST https://lideryprava.ru/api/admin/masterclasses \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Мастер-класс по юридической технике","speaker":"Иванов И. И.",
       "status":"past","recording_url":"https://vk.com/video-1_2","starts_at":"2027-03-10T15:00:00+03:00"}'
```

## Состояние реализации

Каркас — рабочая стартовая база, а не готовый продукт. Ниже честная граница:
что уже работает и проверено, а что описано в ТЗ и ждёт разработки.

### Реализовано и проверено

| Блок | Что сделано |
|---|---|
| Схема БД | Миграции `001`–`010`, 27 таблиц в единственной схеме `liders`, справочники засеяны, повторный прогон идемпотентен |
| Ядро сервера | `config.ts` (fail-fast по обязательным переменным), пул `pg` с `search_path`, мигратор с advisory-lock и `_migrations`, security-headers, in-memory rate-limit, graceful shutdown |
| Аутентификация админа | Stateless HMAC-токен с таблицей отзыва сессий, `requireAdmin`, роли `admin`/`operator` |
| Файлы | Хранение в `media` (BYTEA), MIME-whitelist и проверка magic-байтов, публичные и приватные файлы, отдача по правам |
| Доступ команды | Одноразовые/срочные токены (в БД только SHA-256), журнал обращений, `requireTeam` |
| Публичные данные | Сезон, направления, партнёры, мастер-классы, новости, документы, файлы, приём обращений |
| Личный кабинет | Команда и состав, материалы (файл или ссылка), удаление до дедлайна, дедлайны, связь с организаторами, апелляции |
| Админ-API | Заявки с фильтрами и экспортом CSV, проверка материалов, команды и токены, участники, оценки, рейтинг (расчёт и публикация), апелляции, обращения, настройки с ревизиями, сводка, медиа, CRUD справочников и контента |
| Доменные правила | Дедлайны по московскому времени, запрет записи после срока, расчёт итогового балла по п. 7.7 с флагом `needs_chair_review`, запрет прошедшего мастер-класса без записи (при создании и при изменении) |

### Не реализовано (описано в ТЗ, требует разработки)

| Что | Раздел ТЗ | Примечание |
|---|---|---|
| Форма заявки на сайте (`POST /api/applications`) и проверка статуса заявки | 05, п. 3.2 | Схема под неё готова: `source`, `external_form_id`, `external_response_id` |
| Обмен ссылки-доступа на сессию кабинета | 06, п. 7 | Сейчас кабинет работает по bearer-токену в заголовке; обмена «magic-ссылка → сессия» нет |
| Управление участниками и наставниками из кабинета, подтверждение финала, отказ от участия | 06, п. 3 | Частично: состав меняется через `PATCH /api/cabinet/team` |
| Импорт выгрузки Яндекс.Формы | 05, п. 5 | Есть только поля и уникальный индекс против дублей, импортёра нет |
| Журнал действий `audit_log`, очередь писем `notifications_outbox`, отправка почты | 04, п. 3.7; 06, п. 6 | Транспорт почты не входил в каркас |
| `material_requirements` — состав комплекта и сроки из БД | 04, п. 3.7 | Сейчас перечень обязательных материалов в коде |
| `winners`, `pages` — победители и редактируемые страницы | 04, п. 3.7; 08, п. 5 | Публичные маршруты появятся вместе с таблицами |
| Управление пользователями админки, массовые операции, журнал | 07, п. 2.16–2.17 | — |
| Отдельная сборка интерфейса админ-панели | 07 | В каркасе только API |
| Генерация PDF-сертификатов, счётчики аналитики | 12 | Зависит от ответов О13 и Л9 |

### Как проверено

| Проверка | Команда | Результат |
|---|---|---|
| Типы | `cd platform/server && npx tsc --noEmit` | Без ошибок |
| Миграции | `npm run migrate` на пустой БД | Применяются; повторный запуск — «уже применена» |
| Схема | `psql -c "select table_name from information_schema.tables where table_schema='liders'"` | 27 таблиц, 0 таблиц в других схемах |
| Справочники | `select stage, sum(max_score) from liders.criteria group by stage` | `selection` 70, `stage1` 80, `debate` 45 — совпадает с п. 10.2–10.4 Положения |
| Запуск API | `tsx src/index.ts` + `curl /api/health` | `200`, база `up`, схема `liders` |
| Защита | `curl /api/admin/applications` без токена | `401`; с токеном `200` |
| Дедлайн | `POST /api/cabinet/materials` после срока | `403` и предложение связаться с организаторами |
| Файлы | подделка magic-байтов | `415` |
| Мастер-классы | `status=past` без записи | `400` с пояснением; с `recording_url` — `201` |
| Разделение | `bash platform/scripts/check-decoupling.sh` | Все гейты пройдены |

