import pg from 'pg';
import {
  DATABASE_HOST,
  DATABASE_NAME,
  DATABASE_PASSWORD,
  DATABASE_PORT,
  DATABASE_SCHEMA,
  DATABASE_USER,
} from './config.js';

// Пул соединений. search_path выставляется на каждом соединении, поэтому весь
// прикладной SQL работает с короткими именами таблиц внутри единственной схемы
// проекта (схема создаётся и заполняется миграциями).
const pool = new pg.Pool({
  host: DATABASE_HOST,
  port: DATABASE_PORT,
  database: DATABASE_NAME,
  user: DATABASE_USER,
  password: DATABASE_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const SEARCH_PATH_SQL = `SET search_path TO "${DATABASE_SCHEMA}"`;

pool.on('connect', (client) => {
  void client.query(SEARCH_PATH_SQL).catch((error: unknown) => {
    console.error('Не удалось установить search_path:', (error as Error).message);
  });
});

/** Выполняет одиночный запрос в схеме проекта. */
export async function query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    await client.query(SEARCH_PATH_SQL);
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Выполняет несколько запросов в одной транзакции. Все ошибки откатывают
 * транзакцию и пробрасываются вызывающему коду.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(SEARCH_PATH_SQL);
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Проверка доступности БД для /api/health. */
export async function testConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { DATABASE_SCHEMA };
export default pool;
