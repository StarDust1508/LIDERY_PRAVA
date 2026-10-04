# 04. База данных

Схема описана по эталонной реализации в `platform/migrations` (миграции `001`–`010`). Все таблицы — в единственной схеме `liders`.

## 1. Общие правила

1. **Одна схема — `liders`.** Никаких таблиц в `public`, никакой двухсхемности (в проекте-доноре `011_academy.sql` создаёт таблицы в `public` — эту ошибку не повторяем). `search_path` задаётся в пуле соединений.
2. **Именование:** таблицы — `snake_case` во множественном числе, поля — `snake_case`, внешние ключи — `<сущность>_id`, булевы — `is_*`/`consent_*`/`has_*`, временные метки — `*_at`.
3. **Первичные ключи:** `SERIAL`/`BIGSERIAL` для доменных таблиц; `UUID` (`gen_random_uuid()`) для `media` — идентификатор файла не должен угадываться.
4. **Общие поля:** `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
5. **Никаких физических удалений конкурсных данных.** Статусы вместо удаления; исключение — исполнение требования субъекта ПДн.
6. **Ограничения — в БД:** `CHECK` для статусов и диапазонов, `UNIQUE` для естественных ключей, `FOREIGN KEY` с явным `ON DELETE`.
7. **Время:** всё в `timestamptz`; бизнес-сроки считаются в Europe/Moscow (UTC+3), поле `seasons.timezone` фиксирует зону конкурса.
8. **JSONB** — только для действительно переменной структуры: `site_settings.value`, `evaluations.scores` (баллы по критериям), `access_log.metadata`. Остальное — колонки.

## 2. Ядро платформы

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `users` | Администраторы и операторы | `email` (uniq), `password_hash`, `role` (`admin`/`operator`), `full_name`, `is_active`, `auth_version`, `last_login_at` |
| `media` | Файлы (BYTEA) | `id` (UUID), `file_name`, `file_url`, `file_type`, `file_size`, `file_data`, `is_public`, `category`, `sha256`, `uploaded_by` |
| `admin_session_revocations` | Отзыв админ-сессий | `token_hash` (PK), `expires_at` |
| `auth_log` | Журнал входов | `event`, `email`, `user_id`, `ip`, `user_agent`, `reason` |
| `site_settings` | Настройки | `key` (PK), `value` (JSONB), `description`, `updated_by` |
| `site_settings_revisions` | История настроек | `key`, `value`, `actor` |
| `leads` | Обращения и «связаться с организаторами» | `name`, `email`, `phone`, `topic`, `message`, `source`, `status` (`new`/`in_progress`/`answered`/`closed`/`spam`), `consent_pdn`, `team_id`, `ip`, `user_agent`, `admin_comment` |

## 3. Домен конкурса

### 3.1. Сезон, направления, справочники

| Таблица | Поля |
|---|---|
| `seasons` | `slug` (uniq), `title`, `year`, `status` (`draft`/`published`/`active`/`finished`), `is_active`, `application_open_at`, `application_close_at`, `tech_check_from`, `tech_check_to`, `stage1_from`, `stage1_to`, `final_from`, `final_to`, `appeal_window_days` (по умолчанию 2), `timezone` (`Europe/Moscow`), `description` |
| `directions` | `code` (uniq), `title`, `description`, `sort_order`, `is_active` |

Ограничения: частичный уникальный индекс допускает **ровно один** активный сезон (`is_active`); сроки публичных страниц берутся только из активного сезона, а не из кода.

### 3.2. Команды, участники, наставники

| Таблица | Поля |
|---|---|
| `teams` | `season_id`, `direction_id`, `name`, `organization`, `city`, `captain_participant_id`, `status`, `status_changed_at`, `disqualification_reason` |
| `participants` | `season_id`, `team_id`, `full_name`, `birth_date`, `category`, `organization`, `position`, `education`, `email`, `phone`, `role` (`captain`/`member`), `consent_pdn`, `consent_distribution`, `consent_legal_representative`, `is_minor`, `consent_received`, `consent_received_at` |
| `mentors` | `team_id`, `full_name`, `organization`, `position`, `degree`, `email`, `phone`, `consent_pdn`, `consent_received` |

Статусы команды (`teams.status`): `draft` → `submitted` → `tech_check` → (`tech_rejected` | `allowed`) → `stage1` → `finalist` → `final` → `winner`; терминальные — `disqualified`, `withdrawn`.

Категории участника (`participants.category`): `student`, `magistrant`, `aspirant`, `young_specialist`, `mo_leader`.

Ограничения и проверки:
1. `UNIQUE (season_id, lower(email))` — один участник в одной команде за сезон (п. 4.4 Положения).
2. `UNIQUE (team_id) WHERE role = 'captain'` — ровно один капитан.
3. Наставников не более двух — проверяется на сервере (`mentors` не имеет жёсткого лимита в БД).
4. Численность 2–4 и единоличное участие — проверка на сервере при переводе заявки в статус `submitted`.
5. Возраст 16–35 лет на дату закрытия приёма — проверка на сервере по `birth_date` и `seasons.application_close_at`.

### 3.3. Заявки и материалы

| Таблица | Поля |
|---|---|
| `applications` | `season_id`, `team_id`, `source` (`yandex_form`/`site`), `external_form_id`, `external_response_id`, `submitted_at`, `tech_status`, `tech_checked_at`, `tech_checked_by`, `tech_rejection_reason`, `organizer_notes`, `ip`, `user_agent` |
| `application_materials` | `application_id`, `team_id`, `type`, `media_id`, `external_url`, `version`, `status`, `reviewer_comment`, `reviewed_by`, `reviewed_at`, `fix_deadline`, `uploaded_by` |
| `access_tokens` | `team_id`, `token_hash` (uniq), `label`, `issued_to_email`, `max_uses`, `used_count`, `single_use`, `expires_at`, `revoked_at`, `last_used_at`, `created_by` |
| `access_log` | `subject_type` (`team`/`admin`), `team_id`, `user_id`, `token_id`, `event`, `ip`, `user_agent`, `metadata` |

Статусы технической проверки (`applications.tech_status`): `pending`, `in_review`, `fix_required`, `accepted`, `rejected`.
Типы материалов (`application_materials.type`): `law_draft`, `explanatory_note`, `acts_list`, `comparison_table`, `video_link`, `presentation`, `consent`, `other`.
Статусы материала: `uploaded`, `accepted`, `needs_fix`, `rejected`.

Правила:
1. `UNIQUE (season_id, team_id)` — одна команда, одна заявка в сезоне (п. 4.4).
2. `UNIQUE (external_response_id)` — защита от повторного приёма одной и той же заявки (идемпотентность формы и импорта архива).
3. Материал обязан иметь либо `media_id`, либо непустой `external_url` (ограничение БД).
4. `fix_deadline` — единственный срок досдачи по замечанию (не более 2 рабочих дней, п. 7.5).
5. Токен доступа хранится только в виде хэша; повторная выдача отзывает прежние токены.

### 3.4. Комиссии, критерии, оценки, рейтинг

| Таблица | Поля |
|---|---|
| `experts` | `full_name`, `organization`, `position`, `degree`, `role` (`chair`/`member`), `stage`, `email`, `phone`, `is_active`, `notes` |
| `jury_members` | То же — отдельная таблица для Жюри финального этапа (п. 5.2.1: две независимые комиссии) |
| `criteria` | `stage` (`selection`/`stage1`/`debate`), `code`, `title`, `description`, `max_score`, `sort_order`, `is_active`, `UNIQUE (stage, code)` |
| `evaluations` | `team_id`, `stage`, `expert_id`, `jury_member_id`, `scores` (JSONB: `[{criterion_id, score}]`), `total_score`, `comment`, `is_chair_extra`, `is_final_vote`, `created_by` |
| `rankings` | `season_id`, `team_id`, `stage`, `place`, `average_score`, `jury_total`, `scores_spread`, `needs_chair_review`, `evaluations_count`, `is_published`, `published_at`, `protocol_note` |

Правила расчёта (реализуются серверной функцией, не вручную):
1. `evaluations.total_score` = сумма баллов по критериям; каждый балл не превышает `criteria.max_score` (проверка на сервере).
2. `rankings.average_score` — среднее арифметическое `total_score` всех отправленных оценок этапа, округление до сотых (п. 7.7).
3. `scores_spread` = разница максимальной и минимальной суммы; при значении **более 20** выставляется `needs_chair_review` и итог не публикуется до внесения дополнительной оценки председателя (`is_chair_extra = true`), которая участвует в расчёте среднего.
4. Для дебатов (`stage = 'debate'`) итог — **сумма** баллов членов Жюри (`jury_total`), а не среднее (п. 9.4.2).
5. `UNIQUE (season_id, stage, team_id)` в `rankings` — одна строка рейтинга на команду и этап; `UNIQUE`-индексы в `evaluations` не дают одному эксперту выставить две оценки одной команде на этапе.
6. Публикация рейтинга (`is_published`, `published_at`) — единственный способ показать баллы на сайте; от неё же отсчитывается срок апелляций.

### 3.5. Апелляции

| Таблица | Поля |
|---|---|
| `appeals` | `season_id`, `team_id`, `stage` (`selection`/`stage1`), `grounds`, `text`, `status`, `decision`, `decision_note`, `protocol_url`, `submitted_at`, `deadline_at`, `reviewed_at`, `reviewed_by` |

`grounds` — предмет апелляции по п. 12.2 (нарушение порядка, необоснованный отказ, ошибка в подсчёте, неправильное применение критериев). `deadline_at` вычисляется от фактического времени публикации протокола (`rankings.published_at`) плюс `seasons.appeal_window_days` рабочих дня.

### 3.6. Публичный контент

| Таблица | Поля |
|---|---|
| `masterclasses` | `season_id`, `title`, `speaker`, `speaker_info`, `description`, `status` (`announced`/`past`), `starts_at`, `place`, `recording_url`, `media_id`, `sort_order` |
| `partners` | `name`, `url`, `logo_media_id`, `partner_type`, `description`, `sort_order`, `is_active` |
| `news` | `slug` (uniq), `title`, `type` (`news`/`video`), `cover_media_id`, `video_url`, `excerpt`, `body`, `published_at`, `is_published` |
| `documents` | `type`, `title`, `version`, `revision_date`, `media_id`, `external_url`, `requires_acceptance`, `is_active`, `sort_order` |

Правила:
1. Прошедший мастер-класс (`status = 'past'`) не публикуется без записи: обязателен `recording_url` или `media_id`. Проверка на уровне API.
2. `documents.requires_acceptance` отмечает документы, с которыми соглашается участник при подаче заявки; факт согласия фиксируется в `applications`/`participants` с версией документа.
3. Прежние версии документов не удаляются — помечаются неактивными (`is_active = false`), чтобы можно было доказать, с какой редакцией соглашался участник.

### 3.7. Таблицы, которые предстоит добавить

Эталонная реализация `platform/migrations` пока не содержит следующих таблиц; они описаны в ТЗ и должны быть добавлены отдельными миграциями:

| Таблица | Назначение | Почему нужна |
|---|---|---|
| `material_requirements` | Какие материалы и к какому сроку обязательны на каждом этапе | Без неё список обязательных материалов зашит в код, а сроки меняются решением Оргкомитета |
| `notifications_outbox` | Очередь исходящих писем | Письма о заявках, замечаниях, протоколах и напоминаниях должны иметь журнал и повторные попытки |
| `audit_log` | Журнал админских действий (кто, что, до и после) | Требование раздела 07; `access_log` фиксирует только входы |
| `stage_participation` | Участие команды в этапах, голоса зала на финале, чем определено прохождение | Нужна для групповых выступлений и Гранд-финала (п. 9.3–9.5) |
| `winners` | Победители и призёры по годам и номинациям с фото | Страница «Победители» и раздел «История конкурса» (раздел 08, п. 5) |
| `pages` | Редактируемые страницы («О конкурсе», «История конкурса», FAQ) | Чтобы тексты правились из админки, а не в коде |
| `legacy_applications` | Заявки сезона 2026 из текущей SQLite, только чтение | Сохранение истории и согласий при переезде (раздел 10, этап 3) |

До появления этих таблиц соответствующие функции админки и публичной части считаются нереализованными.

## 4. Индексы (обязательные)

Реализованы: `participants (season_id, lower(email))`, `participants (team_id)`, `participants (team_id) WHERE role='captain'`, `applications (season_id, tech_status)`, `applications (submitted_at DESC)`, `application_materials (application_id, type)`, `application_materials (team_id, created_at DESC)`, `evaluations (team_id, stage)`, `rankings (season_id, stage, place)`, `appeals (status, created_at DESC)`, `leads (status, created_at DESC)`, `media (is_public, category)`, `auth_log (event, created_at DESC)`, `access_tokens (expires_at) WHERE revoked_at IS NULL`.

Требуется добавить вместе с новыми таблицами: индексы по `notifications_outbox (status, created_at)`, `audit_log (entity, entity_id, created_at DESC)`, полнотекстовый поиск `to_tsvector('russian', …)` по `news`, `masterclasses`, `documents`.

## 5. Миграции

1. Нумерация строго последовательная: `001_…`, `002_…`; **пропуски и дубли номеров запрещены** (в проекте-доноре есть пропуски 095–097, 182–183 и дубли 011, 012, 025, 159, 192, 193 — это создаёт неопределённый порядок применения).
2. Один файл — одно логическое изменение. Имя: `NNN_краткое_описание.sql`.
3. Применённый файл **никогда не редактируется**; изменение — новый файл.
4. Каждый файл выполняется в транзакции; раннер берёт advisory-lock, чтобы параллельный запуск не сломал схему (паттерн донора сохранён).
5. Таблица `_migrations` хранит имя файла и контрольную сумму; расхождение суммы применённого файла — ошибка запуска, а не предупреждение.
6. Каждая миграция начинается с `CREATE SCHEMA IF NOT EXISTS liders;` и все таблицы создаёт явно в этой схеме — проверяется гейтом Г5 (раздел 03, п. 6).

## 6. Сиды на старте

Реализовано в `010_reference_data.sql` (`ON CONFLICT DO NOTHING` — повторный запуск безопасен):

| Что | Источник | Состояние |
|---|---|---|
| Сезон `2027` с полным календарём | П. 6.3 Положения | Готово |
| Критерии отборочного этапа (7 × 10) | П. 10.2 | Готово |
| Критерии первого этапа (8 × 10) | П. 10.3 | Готово |
| Критерии дебатов (4 × 10 + 1 × 5) | П. 10.4 | Готово |
| Направления конкурса (7) | П. 3.1.1 (национальные цели) | **Временная замена**: точный перечень — Приложение № 2 (вопрос О8) |
| Партнёры | Раздел 09, п. 8 | Ожидается наполнение через админку |
| Документы | Раздел 09 | Ожидается текст от Ассоциации |

## 7. Резервное копирование и восстановление

1. Ежедневный `pg_dump` в 03:30 (МСК), 30 копий, проверка целостности сразу после создания (`ops/backup/pg-dump.sh`).
2. Дамп включает таблицу `media` (файлы хранятся в БД), поэтому отдельная копия файлов не нужна.
3. Раз в месяц — тестовое восстановление в отдельную БД со сверкой числа записей в `applications`, `participants`, `application_materials`.
4. Выгрузка за пределы сервера — зашифрованная, по расписанию.

## 8. Персональные данные в БД

| Класс | Поля | Кто видит |
|---|---|---|
| ПДн участников | `participants.full_name`, `birth_date`, `email`, `phone`, `organization`, `position`, `education`; `mentors.*` | Админ, Оргкомитет; команда — только свои данные по токену |
| Специальные отметки | `consent_*`, `is_minor`, `consent_received_at` | Админ, ответственный за ПДн |
| Технические ПДн | `leads.ip`, `leads.user_agent`, `applications.ip`, `applications.user_agent`, `auth_log.ip`, `access_log.ip` | Админ |
| Публичные данные | названия команд, имена победителей, фото и видео (при согласии № 12/13) | Все |

Правила:
1. **Ретенция:** 3 года с завершения сезона, затем удаление или обезличивание (подтвердить у Ассоциации — вопрос О10). Каждое продление фиксируется в журнале.
2. Запрос субъекта исполняется ответственным за ПДн; в админке — «Экспорт данных субъекта» и «Удалить данные субъекта» с журналированием.
3. Отзыв согласия переводит участника в статус `withdrawn` и блокирует публикацию его материалов.
4. Экспорт для Оргкомитета выполняется **без** `ip`, `user_agent` и без скан-копий согласий, если они не запрошены отдельно.
5. Ни один публичный эндпоинт не возвращает ПДн — проверяется тестом (раздел 12).

## 9. Поля, обязательные по формам Приложений № 1 и № 9

Эталонная схема `platform/migrations` этих полей пока не содержит — их нужно добавить миграцией `011` (состав определён Приложением № 1, состав полей обязателен).

**`teams` / `applications` (сведения об инициативе):**
`law_title` (наименование законопроекта), `act_level` (`federal_constitutional` / `federal` / `regional`), `proposed_initiator` (предполагаемый субъект права законодательной инициативы), `annotation` (не более 1000 знаков), `ai_usage` (bool), `ai_usage_purpose` (text), `is_solo` (bool), `solo_approved_at`.

**`participants`:**
`citizenship`, `region` (субъект РФ), `settlement` (населённый пункт), `vk_url`, `competencies` (не более 800 знаков), `personal_contribution`, а также детализация образования: `faculty`, `course`, `study_program` (или `position` для работающих).

**`mentors`:** `academic_degree` (учёная степень), `academic_title` (учёное звание).

**`participant_distribution_consents` (новая таблица, Приложение № 12):** построчное согласие по категориям — ФИО, организация/статус, субъект РФ и населённый пункт, команда/инициатива/результаты, изображение и голос, ссылка на соцсеть. Поля: `participant_id`, `category_code`, `allowed` (bool), `conditions` (text: запреты и условия), `signed_at`.

**`evaluations`:** обоснование по каждому критерию и рекомендации команде — элементы `scores` получают вид `{criterion_id, score, comment}`, добавляется поле `recommendations` (Приложение № 9).

**`documents`:** 14 строк для Приложений № 1–14 с `type = 'appendix'` и номером в заголовке; PDF обоих документов уже лежат в `platform/public/docs/`.

**Файлы:** шаблон имени «Команда_Документ» (Приложение № 6, п. 3) — подсказка в интерфейсе загрузки и предупреждение при несоответствии; обязательные форматы `.docx` и `.pdf`.

## 10. Архив законопроектов (таблицы)

| Таблица | Поля |
|---|---|
| `initiatives` | `season_id`, `team_id` (nullable — для записей прошлых лет), `direction_id`, `slug` (uniq), `title` (название законопроекта), `annotation`, `act_level`, `proposed_initiator`, `team_name` (текстом — для архивных записей без команды в БД), `result_place` (1–3 / NULL), `nomination`, `law_draft_media_id`, `explanatory_note_media_id`, `video_url`, `is_published`, `published_at`, `authors_public` (bool), `files_public` (bool), `archive_year`, `sort_order` |
| `initiative_authors` | `initiative_id`, `full_name`, `organization`, `region`, `is_published` (по категориям согласия Приложения № 12) — чтобы публиковать авторов выборочно, а не всех или никого |

Правила:
1. `authors_public = false` → блок авторов не отдаётся публичным API вообще (проверка на сервере, не в интерфейсе).
2. `files_public = false` → `law_draft_media_id` и `explanatory_note_media_id` не отдаются; публичные файлы имеют `media.is_public = true`.
3. Публикация (`is_published`) — только действие администратора; `published_at` заполняется при публикации и используется в сортировке и `sitemap.xml`.
4. Полнотекстовый индекс: `to_tsvector('russian', title || ' ' || annotation || ' ' || team_name)`.

Миграции: создаются в пакете 1 (миграция `011`+).
