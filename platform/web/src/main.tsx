import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Шрифты и токены — из дизайн-системы (platform/design/DESIGN.md).
// Подключены локально: сайт конкурса не обращается к зарубежным сервисам.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/index.css';
// Оформление прежнего сайта конкурса (перенесено скриптом build-site-css.mjs).
// Идёт последним: правила ограничены областью .site и описывают публичную часть.
import './site/site.css';

import { App } from './app/App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Не найден корневой элемент #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
