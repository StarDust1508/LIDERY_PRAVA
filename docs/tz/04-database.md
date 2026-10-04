# 04. База данных

## 1. Общие правила

1. **Одна схема — `liders`.** Никаких таблиц в `public`, никакой двухсхемности (в доноре `011_academy.sql` создаёт таблицы в `public` — эту ошибку не повторяем). `search_path` задаётся в пуле соединений.
2. **Именование:** таблицы — `snake_case` во множественном числе, поля — `snake_case`, внешние ключи — `<сущность>_id`, булевы — `is_*`/`has_*`, временные метки — `*_at`.
3. **Первичный ключ:** `id bigserial primary key` во всех таблицах, кроме `_migrations`.
4. **Общие поля:** `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (обновляется триггером `set_updated_at`).
5. **Никаких удалений конкурсных данных.** Вместо удаления — статус или `deleted_at`. Физическое удаление только по ретенции ПДн (п. 8).
6. **Ограничения — в БД, а не только в коде.** `CHECK` для статусов и диапазонов баллов, `UNIQUE` для естественных ключей, `FOREIGN KEY` с явным `ON DELETE`.
7. **Время:** всё в `timestamptz`; бизнес-сроки считаются в Europe/Moscow (UTC+3).
8. **JSONB** только там, где структура действительно переменная (настройки, снимок баллов). Основные поля — колонки.

## 2. Ядро

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `_migrations` | Журнал применённых миграций | `filename`, `applied_at`, `checksum` |
| `users` | Администраторы и операторы | `email` (uniq), `password_hash` (bcrypt), `role` (`admin`/`operator`), `is_active`, `auth_version` |
| `admin_session_revocations` | Отзыв админ-сессий | `token_hash` (sha256), `expires_at`, `reason` |
| `auth_log` | Журнал входов | `user_id`, `email`, `ip`, `user_agent`, `result`, `created_at` |
| `media` | Файлы | `id`, `filename`, `mime`, `size_bytes`, `bytes` (BYTEA), `checksum_sha256`, `is_public`, `uploaded_by_user_id`, `created_at` |
| `site_settings` | Настройки ключ-значение | `key` (uniq), `value` (JSONB), `updated_by_user_id`, `updated_at` |
| `site_settings_revisions` | История настроек | `key`, `value`, `changed_by_user_id`, `changed_at` |
| `leads` | Обращения и «связаться с организаторами» | `name`, `email`, `phone`, `topic`, `message`, `source` (`public_form`/`cabinet_deadline`/`cabinet_help`), `team_id`, `status`, `source_ip`, `created_at` |
| `audit_log` | Журнал админских действий | `user_id`, `action`, `entity`, `entity_id`, `before` (JSONB), `after` (JSONB), `created_at` |
| `notifications_outbox` | Исходящие письма | `to_email`, `template`, `payload` (JSONB), `status` (`pending`/`sent`/`failed`), `attempts`, `last_error`, `sent_at` |

## 3. Домен конкурса

### 3.1. Сезон и направления

| Таблица | Поля |
|---|---|
| `seasons` | `slug` (uniq, `liders-2027`), `title`, `status` (`draft`/`active`/`archive`), `applications_open_at`, `applications_close_at`, `tech_check_until`, `selection_results_at`, `appeal_window_days` (2), `stage1_video_until`, `stage1_results_at`, `final_planned_at`, `final_announce_days` (30), `is_current` |
| `directions` | `season_id`, `code`, `title`, `description`, `sort_order`, `is_active` — наполняется из Приложения № 2 |

Правило: **ровно один** сезон с `is_current = true` (частичный уникальный индекс). Все публичные страницы берут сроки из активного сезона, а не из кода.

### 3.2. Команды, участники, наставники

| Таблица | Поля |
|---|---|
| `teams` | `season_id`, `name`, `direction_id`, `captain_participant_id`, `status`, `is_solo`, `solo_approved_at`, `status_changed_at`, `disqualification_reason`, `created_at` |
| `participants` | `team_id`, `full_name`, `birth_date`, `category` (`student`/`master`/`postgraduate`/`young_specialist`/`youth_leader`), `organization`, `education_level`, `email`, `phone`, `role` (`captain`/`member`), `is_minor`, `person_key` (генерируемое `lower(email)`), `consent_pdn_at`, `consent_distribution_at`, `consent_legal_rep_at` |
| `mentors` | `team_id`, `full_name`, `organization`, `position`, `email`, `phone`, `consent_pdn_at` |

Статусы команды (`teams.status`): `draft` → `submitted` → `tech_check` → (`tech_rejected` | `allowed`) → `stage1` → (`finalist` | `not_finalist`) → `final` → (`winner` | `prize2` | `prize3` | `finalist_diploma`) и терминальные `disqualified`, `withdrawn`.

Ограничения:
- `UNIQUE (season_id, lower(email))` на `participants` через `person_key` — один участник в одной команде за сезон.
- `UNIQUE (team_id, mentor_slot)` где `mentor_slot` ∈ {1, 2} — не более двух наставников.
- `CHECK` численности 2–4 при переходе в статус `submitted` — проверяется транзакционно при отправке заявки; для `is_solo = true` требуется `solo_approved_at`.

### 3.3. Заявки и материалы

| Таблица | Поля |
|---|---|
| `applications` | `season_id`, `team_id` (uniq в сезоне), `source` (`yandex_form`/`site`), `external_form_id`, `submitted_at`, `tech_check_status` (`pending`/`in_review`/`accepted`/`needs_fix`/`rejected`), `tech_check_comment`, `fix_deadline_at`, `fix_requested_once` (bool), `idempotency_key` (uniq), `source_ip`, `user_agent` |
| `application_materials` | `application_id`, `type`, `status` (`uploaded`/`accepted`/`needs_fix`/`rejected`), `media_id`, `external_url`, `version`, `comment`, `review_comment`, `reviewed_by_user_id`, `reviewed_at`, `is_content_locked` (после окончания приёма — запрет изменения содержания), `created_at` |
| `material_requirements` | `season_id`, `stage` (`selection`/`stage1`/`final`), `type`, `is_required`, `deadline_at`, `accepted_mime`, `max_size_bytes`, `hint` — какие материалы и к какому сроку нужны |
| `team_access_tokens` | `team_id`, `token_hash`, `expires_at`, `used_at`, `issued_by_user_id`, `revoked_at`, `label` |

Типы материалов (`application_materials.type`): `application_form`, `law_draft`, `explanatory_note`, `acts_list`, `comparison_table`, `video_link`, `presentation`, `status_proof`, `consent_pdn`, `consent_distribution`, `consent_legal_rep`, `other`.

Правила:
1. `applications.team_id` уникален в сезоне — одна команда, одна заявка (п. 4.4 Положения).
2. `external_url` разрешён только для `video_link`; домены проверяются по белому списку (ВК, российские облачные сервисы), зарубежные — отклоняются (п. 14.4).
3. `fix_deadline_at` устанавливается только один раз (`fix_requested_once`).
4. После `applications.tech_check_status = 'accepted'` изменение содержания материалов блокируется флагом `is_content_locked`.

### 3.4. Экспертиза, оценки, рейтинги

| Таблица | Поля |
|---|---|
| `experts` | `season_id`, `full_name`, `organization`, `position`, `role` (`commission`/`jury`/`expert`), `stage` (`selection`/`stage1`/`final`), `email`, `is_active`, `user_id` (если у эксперта есть доступ) |
| `criteria` | `season_id`, `stage` (`selection`/`stage1`/`debate`), `code`, `title`, `max_score` (10 или 5), `sort_order` |
| `evaluations` | `application_id` (или `team_id` для дебатов), `expert_id`, `stage`, `status` (`draft`/`submitted`), `total_score`, `comment`, `is_chair_extra` (доп. оценка председателя), `is_conflicted` (заявлен конфликт интересов), `submitted_at` |
| `evaluation_scores` | `evaluation_id`, `criterion_id`, `score`, `comment` |
| `rankings` | `season_id`, `stage`, `team_id`, `total_score`, `rank`, `is_published`, `published_at`, `protocol_media_id` |
| `stage_participation` | `season_id`, `stage`, `team_id`, `advanced` (прошла ли дальше), `votes_public` (голоса зала на финале), `decided_by` (`score`/`chair`/`vote`) |

Правила расчёта (реализуются серверной функцией, а не вручную):
1. `evaluations.total_score` = сумма `evaluation_scores.score`; проверяется `score <= criteria.max_score` и `score >= 0`.
2. Итог этапа — среднее арифметическое `total_score` всех отправленных оценок, округление до сотых (п. 7.7).
3. Если `max(total_score) - min(total_score) > 20` — система ставит команде флаг «требуется дополнительная оценка председателя» и не публикует итог до её внесения (`is_chair_extra = true`).
4. Итог дебатов — сумма баллов всех членов Жюри (п. 9.4.2), не среднее.
5. Ранжирование — по убыванию итога; при равенстве на `stage1` — по баллу `selection`; на `debate` — по критерию «Убедительность и эффективность доводов», далее — решение председателя (`decided_by = 'chair'`).
6. Публикация рейтинга (`is_published`) — единственный способ показать баллы на сайте; до публикации данные недоступны даже участникам.

### 3.5. Апелляции

| Таблица | Поля |
|---|---|
| `appeals` | `season_id`, `stage`, `team_id`, `submitted_by_participant_id` (капитан), `subject` (`procedure_violation`/`wrongful_rejection`/`scoring_error`/`criteria_misuse`), `body`, `media_id` (скан по форме Приложения № 14), `status` (`submitted`/`in_review`/`granted`/`partially_granted`/`denied`), `decision_body`, `decided_at`, `protocol_media_id` |
| `appeal_deadline_cache` | Вычисляемый срок приёма апелляций на этап: `stage`, `opened_at`, `closes_at` — заполняется при публикации протокола |

Правило: срок приёма апелляций стартует от **фактического времени публикации протокола** (`rankings.published_at`), а не от плановой даты.

### 3.6. Публичный контент

| Таблица | Поля |
|---|---|
| `masterclasses` | `season_id`, `title`, `slug` (uniq), `speaker_name`, `speaker_position`, `description`, `starts_at`, `status` (`announced`/`past`/`cancelled`), `recording_url`, `recording_media_id`, `cover_media_id`, `is_published`, `sort_order` |
| `partners` | `season_id`, `name`, `url`, `logo_media_id`, `tier` (`general`/`sponsor`/`information`/`venue`), `description`, `sort_order`, `is_published` |
| `news` | `season_id`, `slug` (uniq), `title`, `type` (`news`/`video`), `announce`, `body` (markdown), `cover_media_id`, `video_url`, `published_at`, `is_published` |
| `documents` | `type` (`regulations_pdf`/`offer`/`privacy_policy`/`pdn_consent`/`distribution_consent`/`cookies`/`terms`/`appendix`), `title`, `version`, `revision_date`, `media_id` (PDF), `external_url`, `is_required_for_application`, `sort_order`, `is_published` |
| `winners` | `season_id`, `year`, `place`, `nomination`, `team_name`, `team_members` (JSONB), `photo_media_id`, `project_title`, `description`, `is_published` |
| `pages` | `slug` (uniq), `title`, `body` (markdown/блоки), `seo_title`, `seo_description`, `is_published` — для страниц «О конкурсе», «История конкурса» и подобных |

Правило по мастер-классам (требование Оргкомитета): записи прошлых мастер-классов **смотрятся на сайте**, поэтому `status = 'past'` требует заполненного `recording_url` или `recording_media_id`; публикация «прошедшего» мастер-класса без записи блокируется на уровне API.

### 3.7. Приложения-формы Положения

Формы Приложений № 1–14 хранятся как `documents` с `type = 'appendix'` и номером в `title` (например «Приложение № 3. Текст законопроекта»). Если Оргкомитет передаст формы в редактируемом виде, дополнительно заводится `document_templates` (описание полей формы) — до получения форм таблица не создаётся.

## 4. Индексы (обязательные)

1. `participants (team_id)`, `participants (person_key)`, `participants (lower(email))`.
2. `applications (season_id, tech_check_status)`, `applications (submitted_at desc)`.
3. `application_materials (application_id, type)`.
4. `evaluations (application_id, stage)`, `evaluations (expert_id, stage)`.
5. `rankings (season_id, stage, rank)`.
6. `leads (status, created_at desc)`.
7. `media (is_public, created_at desc)`.
8. Полнотекстовый поиск: `to_tsvector('russian', …)` по `news`, `masterclasses`, `documents` — для поиска по сайту.

## 5. Миграции

1. Нумерация строго последовательная: `001_…`, `002_…`; **пропуски и дубли номеров запрещены** (в доноре есть пропуски 095–097, 182–183 и дубли 011, 012, 025, 159, 192, 193 — это создаёт неопределённый порядок).
2. Один файл — одно логическое изменение. Имя: `NNN_краткое_описание.sql`.
3. Применённый файл **никогда не редактируется**; изменение — новый файл.
4. Каждый файл выполняется в транзакции; раннер берёт advisory-lock, чтобы параллельный запуск не сломал схему.
5. `_migrations` хранит `checksum`; расхождение контрольной суммы применённого файла — ошибка запуска, а не предупреждение.
6. Отдельные файлы `*_seed.sql` наполняют справочники: критерии (п. 10.2–10.4 известны), календарь сезона 2027, список документов, партнёры (4 известны), направления (после получения Приложения № 2).

## 6. Сиды на старте

| Что | Источник | Готовность |
|---|---|---|
| Сезон `liders-2027` с календарём | П. 6.3 Положения | Готово |
| Критерии отборочного этапа (7 × 10) | П. 10.2 | Готово |
| Критерии первого этапа (8 × 10) | П. 10.3 | Готово |
| Критерии дебатов (4 × 10 + 1 × 5) | П. 10.4 | Готово |
| Направления конкурса | Приложение № 2 | **Ожидается** |
| Партнёры: ТехнологИИ Права, АЮР, АСПБ, Ассоциация выпускников | Данные сайта | Готово (логотипы — от Оргкомитета) |
| Документы | Раздел 09 | Ожидается текст от Ассоциации |

## 7. Резервное копирование и восстановление

1. Ежедневный `pg_dump` в 03:30 (МСК) + хранение 30 копий, как на текущем сайте.
2. Копия файлов `media` — тем же заданием (дамп БД уже содержит BYTEA, отдельная копия не нужна; при переходе на диск — копировать каталог).
3. Проверка восстановления: раз в месяц развернуть дамп в тестовую БД и убедиться, что число записей в `applications`, `participants`, `application_materials` совпадает.
4. Выгрузка за пределы сервера — по расписанию (сохранить текущую схему off-site pull) с шифрованием.

## 8. Персональные данные в БД

| Класс | Поля | Хранение | Кто видит |
|---|---|---|---|
| ПДн участников | `participants.full_name`, `birth_date`, `email`, `phone`, `organization`; `mentors.*` | В БД на территории РФ | Админ, Оргкомитет; сама команда — только свои данные по токену |
| Специальные отметки | согласия, `is_minor` | В БД | Админ, ответственный за ПДн |
| Технические ПДн | `leads.source_ip`, `applications.source_ip`, `user_agent`, `auth_log.ip` | В БД | Админ |
| Публичные данные | названия команд, имена победителей, фото (при согласии № 12/13) | В БД + сайт | Все |

Правила:
1. **Ретенция:** заявки и ПДн хранятся 3 года с момента завершения сезона, затем удаляются или обезличиваются. Каждый год продления фиксируется в `audit_log`. Срок подтвердить у Ассоциации (текущие документы сайта называют 3 года).
2. Запрос субъекта на доступ/удаление исполняется вручную ответственным за ПДн; в админке должна быть кнопка «Экспорт данных субъекта» и «Удалить данные субъекта» с журналированием.
3. Отзыв согласия переводит участника в статус `withdrawn` и блокирует публикацию его материалов.
4. Экспорт в Excel/CSV для Оргкомитета выполняется **без** полей `source_ip`, `user_agent` и без скан-копий согласий, если они не запрошены отдельно.
