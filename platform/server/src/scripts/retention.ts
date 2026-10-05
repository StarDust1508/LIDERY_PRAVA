// Ретенция персональных данных (ТЗ 11, п. 5).
//
// Правило: персональные данные хранятся три года с завершения сезона, затем
// обезличиваются. Проверка выполняется ежегодно и журналируется — иначе
// «удаление по сроку» существует только на бумаге.
//
// Запуск (на сервере, от имени сервиса или root с файлом окружения):
//   npm run retention            # обезличить всё, что вышло за срок хранения
//   npm run retention -- --dry-run   # показать, что будет обезличено
//   npm run retention -- --years=3   # изменить срок хранения
//
// Что именно обезличивается:
//   • участники и наставники сезонов, завершившихся более `years` лет назад;
//   • согласия этих участников отзываются (дата отзыва сохраняется);
//   • заявки архива 2026 старше срока;
//   • обращения (leads) старше срока.
// Команды, результаты и оценки сохраняются: они не содержат персональных данных
// после обезличивания и нужны для истории конкурса.

import pool, { query } from '../db.js';

const ERASED_NAME = 'Обезличено по сроку хранения';
const ERASED_EMAIL = 'erased@invalid.local';

interface Options {
  dryRun: boolean;
  years: number;
}

function parseOptions(argv: string[]): Options {
  const dryRun = argv.includes('--dry-run');
  const yearsArg = argv.find((item) => item.startsWith('--years='));
  const years = yearsArg ? Number.parseInt(yearsArg.split('=')[1] ?? '', 10) : 3;
  return { dryRun, years: Number.isFinite(years) && years > 0 ? years : 3 };
}

interface SeasonRow {
  id: number;
  slug: string;
  title: string;
  finished_at: string | null;
}

/** Дата, после которой данные сезона подлежат обезличиванию. */
function retentionDate(finishedAt: string | null, years: number): Date | null {
  if (!finishedAt) return null;
  const date = new Date(finishedAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setFullYear(date.getFullYear() + years);
  return date;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log(
    `Ретенция персональных данных: срок хранения ${options.years} года с завершения сезона` +
      (options.dryRun ? ' (предварительный просмотр)' : '')
  );

  // Сезон считается завершённым по последней дате календаря: финал или
  // мероприятия после финала, если они заданы.
  const seasons = await query(
    `SELECT id, slug, title,
            COALESCE(post_final_to, final_to) AS finished_at
       FROM seasons
      WHERE COALESCE(post_final_to, final_to) IS NOT NULL
      ORDER BY finished_at`
  );

  const now = new Date();
  let totalAnonymized = 0;
  const report: Array<Record<string, unknown>> = [];

  for (const season of seasons.rows as SeasonRow[]) {
    const cutoff = retentionDate(season.finished_at, options.years);
    if (!cutoff || cutoff > now) {
      report.push({ season: season.slug, action: 'сохранение', cutoff: cutoff?.toISOString() ?? null });
      continue;
    }

    const participants = await query(
      `SELECT count(*)::int AS total FROM participants
        WHERE season_id = $1 AND full_name <> $2`,
      [season.id, ERASED_NAME]
    );
    const mentors = await query(
      `SELECT count(*)::int AS total FROM mentors m
         JOIN teams t ON t.id = m.team_id
        WHERE t.season_id = $1 AND m.full_name <> $2`,
      [season.id, ERASED_NAME]
    );
    const count = Number(participants.rows[0]?.total ?? 0) + Number(mentors.rows[0]?.total ?? 0);

    report.push({ season: season.slug, action: 'обезличивание', cutoff: cutoff.toISOString(), subjects: count });

    if (options.dryRun || count === 0) {
      totalAnonymized += options.dryRun ? count : 0;
      continue;
    }

    // Обезличивание в одной транзакции: либо все данные сезона закрыты, либо
    // ничего — частично обезличенный сезон невозможно разобрать.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE participants
            SET full_name = $2, email = $3, phone = NULL, birth_date = NULL, region = NULL,
                settlement = NULL, vk_url = NULL, organization = NULL, position = NULL,
                education = NULL, competencies = NULL, personal_contribution = NULL,
                faculty = NULL, study_program = NULL, citizenship = NULL, is_minor = FALSE,
                consent_pdn = FALSE, consent_distribution = FALSE,
                consent_legal_representative = FALSE, consent_received = FALSE,
                consent_received_at = NULL, updated_at = now()
          WHERE season_id = $1 AND full_name <> $2`,
        [season.id, ERASED_NAME, ERASED_EMAIL]
      );
      await client.query(
        `UPDATE mentors m
            SET full_name = $2, email = NULL, phone = NULL, organization = NULL, position = NULL,
                degree = NULL, academic_degree = NULL, academic_title = NULL,
                consent_pdn = FALSE, consent_received = FALSE, consent_received_at = NULL,
                updated_at = now()
           FROM teams t
          WHERE t.id = m.team_id AND t.season_id = $1 AND m.full_name <> $2`,
        [season.id, ERASED_NAME]
      );
      await client.query(
        `UPDATE consents c
            SET revoked_at = now(), updated_at = now()
           FROM teams t
          WHERE t.id = c.team_id AND t.season_id = $1 AND c.revoked_at IS NULL`,
        [season.id]
      );
      await client.query(
        `UPDATE participant_distribution_consents dc
            SET allowed = FALSE, revoked_at = now(), updated_at = now()
           FROM participants p
          WHERE p.id = dc.participant_id AND p.season_id = $1 AND dc.revoked_at IS NULL`,
        [season.id]
      );
      await client.query(
        `INSERT INTO pdn_retention_runs (season_id, season_slug, cutoff_at, anonymized, report, actor, finished_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())`,
        [
          season.id,
          season.slug,
          cutoff.toISOString(),
          count,
          JSON.stringify({ participants: participants.rows[0]?.total ?? 0, mentors: mentors.rows[0]?.total ?? 0 }),
          'retention-job',
        ]
      );
      await client.query(
        `INSERT INTO audit_log (actor_type, actor_label, action, entity, entity_id, after)
         VALUES ('system', 'retention-job', 'pdn_retention_anonymize', 'seasons', $1, $2::jsonb)`,
        [String(season.id), JSON.stringify({ cutoff: cutoff.toISOString(), anonymized: count })]
      );
      await client.query('COMMIT');
      totalAnonymized += count;
      console.log(`  сезон ${season.slug}: обезличено записей — ${count}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Архив заявок 2026 и обращения живут по тому же сроку.
  const archiveCutoff = new Date();
  archiveCutoff.setFullYear(archiveCutoff.getFullYear() - options.years);
  const archive = await query(
    `SELECT count(*)::int AS total FROM legacy_applications
      WHERE full_name <> $1 AND COALESCE(submitted_at, imported_at) < $2`,
    [ERASED_NAME, archiveCutoff.toISOString()]
  );
  const oldLeads = await query(
    `SELECT count(*)::int AS total FROM leads
      WHERE name <> $1 AND created_at < $2`,
    [ERASED_NAME, archiveCutoff.toISOString()]
  );
  report.push({
    season: 'архив и обращения',
    archive_records: archive.rows[0]?.total ?? 0,
    leads: oldLeads.rows[0]?.total ?? 0,
    cutoff: archiveCutoff.toISOString(),
  });

  if (!options.dryRun) {
    await query(
      `UPDATE legacy_applications
          SET full_name = $1, email = $3, phone = NULL, organization = NULL,
              consent_pdn = FALSE, consent_terms = FALSE, consent_marketing = FALSE,
              consent_at = NULL, source_ip = NULL,
              admin_notes = COALESCE(admin_notes, '') || $4
        WHERE full_name <> $1 AND COALESCE(submitted_at, imported_at) < $2`,
      [ERASED_NAME, archiveCutoff.toISOString(), ERASED_EMAIL, `\n${ERASED_NAME} (срок хранения)`]
    );
    await query(
      `UPDATE leads
          SET name = $1, email = $3, phone = NULL, message = $4
        WHERE name <> $1 AND created_at < $2`,
      [ERASED_NAME, archiveCutoff.toISOString(), ERASED_EMAIL, 'Обезличено по сроку хранения.']
    );
  }

  console.log('\nОтчёт:');
  for (const line of report) console.log(' ', JSON.stringify(line));
  console.log(
    options.dryRun
      ? `\nПредварительный просмотр: к обезличиванию ${totalAnonymized} записей. Запустите без --dry-run.`
      : `\nОбезличено записей: ${totalAnonymized}. Запись о прогоне — в таблице pdn_retention_runs, факт — в журнале действий.`
  );
}

main()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error('Ретенция не выполнена:', (error as Error).message);
    await pool.end();
    process.exitCode = 1;
  });
