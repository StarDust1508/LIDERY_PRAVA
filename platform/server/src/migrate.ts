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

    const applied = await client.query(`SELECT name FROM "${schema}"._migrations ORDER BY id`);
    const executed = new Set(applied.rows.map((row: { name: string }) => row.name));

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

    for (const file of files) {
      if (executed.has(file)) {
        console.log(`⏭  ${file} — уже применена`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`▶  Применяем ${file}…`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO "${schema}"._migrations (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        console.log(`✅ ${file} применена`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error(`❌ Ошибка в ${file}:`, (error as Error).message);
        throw error;
      }
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
