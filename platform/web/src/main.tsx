import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Шрифты и токены — из дизайн-системы (platform/design/DESIGN.md).
// Подключены локально: сайт конкурса не обращается к зарубежным сервисам.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/index.css';

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
