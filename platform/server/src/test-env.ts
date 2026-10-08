// Переменные окружения для тестов.
//
// Модули конфигурации проверяют обязательные секреты при загрузке и падают без
// них. Чтобы тесты можно было запускать одной командой (в том числе в CI, где
// нет /etc/lideryprava/api.env), этот файл подставляет безопасные значения.
// Он импортируется первым: ESM выполняет импорты по порядку объявления, поэтому
// проверка конфигурации увидит уже заполненные значения.
//
// Значения — заведомо тестовые: они не используются нигде, кроме проверок.

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_NAME: 'liders_test',
  DATABASE_USER: 'liders_test',
  DATABASE_PASSWORD: 'test-password',
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
