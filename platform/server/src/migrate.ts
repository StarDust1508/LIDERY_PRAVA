import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import { DATABASE_SCHEMA } from './config.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// Каталог миграций лежит рядом с каталогом server: platform/migrations.
const migrationsDir = path.resolve(currentDir, '../../migrations');

// Один session-level advisory-lock на весь прогон: два параллельных релиза не
// применят один и тот же файл дважды.
const LOCK_KEY = 'liders-platform-migrations';

async function runMigrations(includeSeed: boolean): Promise<void> {
  const schema = DATABASE_SCHEMA;
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}"._migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Контрольная сумма применённого файла (ТЗ 04, п. 5.5). Без неё правка уже
    // применённой миграции проходит незаметно: база остаётся в прежнем виде, а
    // файл описывает другое состояние, и расхождение всплывает на проде.
    await client.query(`ALTER TABLE "${schema}"._migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);

    const applied = await client.query(`SELECT name, checksum FROM "${schema}"._migrations ORDER BY id`);
    const executed = new Map<string, string | null>(
      applied.rows.map((row: { name: string; checksum: string | null }) => [row.name, row.checksum])
    );

    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Каталог миграций не найден: ${migrationsDir}`);
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => includeSeed || !file.includes('seed'))
      // Служебные файлы macOS (._имя.sql) — не SQL, а обёртка AppleDouble:
      // Postgres на них отвечает «invalid message format».
      .filter((file) => !file.startsWith('._'))
      .sort();

    if (files.length === 0) {
      console.log('Файлы миграций не найдены — нечего применять.');
    }

    const changed: string[] = [];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (executed.has(file)) {
        const previous = executed.get(file) ?? null;
        if (previous === null) {
          // Миграция применена до появления контрольных сумм: фиксируем сумму
          // текущего файла, чтобы дальше расхождения отслеживались.
          await client.query(`UPDATE "${schema}"._migrations SET checksum = $2 WHERE name = $1`, [file, checksum]);
          console.log(`⏭  ${file} — уже применена (сумма зафиксирована)`);
        } else if (previous !== checksum) {
          changed.push(file);
          console.log(`⚠️  ${file} — файл изменён после применения`);
        } else {
          console.log(`⏭  ${file} — уже применена`);
        }
        continue;
      }
      console.log(`▶  Применяем ${file}…`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO "${schema}"._migrations (name, checksum) VALUES ($1, $2)`, [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
        console.log(`✅ ${file} применена`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error(`❌ Ошибка в ${file}:`, (error as Error).message);
        throw error;
      }
    }

    if (changed.length > 0) {
      throw new Error(
        'Изменены уже применённые миграции: ' +
          changed.join(', ') +
          '. Правки в применённый файл вносить нельзя — создайте новую миграцию. ' +
          'Если база в другом окружении ещё не знает об этом файле, расхождение всё равно останется.'
      );
    }

    console.log('🎉 Миграции применены.');
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}

const includeSeed = process.argv.includes('--seed');

runMigrations(includeSeed)
  .then(async () => {
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error('Миграции не применены:', error);
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
  });
