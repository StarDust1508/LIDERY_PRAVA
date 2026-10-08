// Переменные окружения для тестов.
//
// Модули конфигурации проверяют обязательные секреты при загрузке и падают без
// них. Чтобы тесты можно было запускать одной командой (в том числе в CI, где
// нет /etc/lideryprava/api.env), этот файл подставляет безопасные значения.
// Он импортируется первым: ESM выполняет импорты по порядку объявления, поэтому
// проверка конфигурации увидит уже заполненные значения. Импорт обязателен в
// КАЖДОМ файле тестов: файлы выполняются в отдельных процессах, а у разработчика
// значения подставляет platform/.env — без явного импорта тест проходит локально
// и падает в CI, где файла окружения нет.
//
// Набор переменных совпадает со списком обязательных в config.ts: если добавить
// туда переменную и забыть здесь, тесты упадут не у разработчика (у которого есть
// platform/.env), а в CI — поэтому состав проверяется запуском с пустым
// окружением: env -i … npm test.
//
// Значения — заведомо тестовые: они не используются нигде, кроме проверок.

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'liders_test',
  DATABASE_USER: 'liders_test',
  DATABASE_PASSWORD: 'test-password',
  // Порт обязателен наравне с остальными: без него конфигурация не загружается.
  JWT_SECRET: 'test-jwt-secret-not-shorter-than-32-symbols',
  ADMIN_SESSION_SECRET: 'test-admin-session-secret-32-symbols',
  ADMIN_PASSWORD: 'test-admin-password',
  PUBLIC_BASE_URL: 'https://lideryprava.test',
  CORS_ORIGINS: 'https://lideryprava.test',
};

for (const [name, value] of Object.entries(DEFAULTS)) {
  if (process.env[name] === undefined || process.env[name] === '') {
    process.env[name] = value;
  }
}
