import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Та же дизайн-система, что и у публичной части: шрифты подключены локально.
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
