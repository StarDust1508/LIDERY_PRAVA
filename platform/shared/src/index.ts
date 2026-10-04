// Общий код публичной части и админки платформы «Лидеры права – 2027».
// Подключается алиасом @shared: отдельной публикации пакета нет.

export * from './types';
export * from './format';
export * from './ui';
export { api, ApiError } from './api';
export { adminApi, AdminApiError, getAdminToken, setAdminToken } from './adminApi';
