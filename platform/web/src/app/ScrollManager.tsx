import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Возврат страницы к началу при переходе.
//
// Дефект, который это исправляет: одностраничное приложение не сбрасывало
// прокрутку, поэтому переход по ссылке из середины длинной страницы открывал
// следующую страницу на той же высоте — «пользователь оказывался внизу».
//
// Правила:
//   • переход вперёд (PUSH/REPLACE) — всегда к началу страницы;
//   • возврат назад/вперёд по истории (POP) — положение восстанавливает браузер,
//     поэтому не мешаем: так участник возвращается к тому месту списка, где был;
//   • ссылка с якорем (/stages/calendar#dates) — плавно к нужному блоку, с учётом
//     высоты закреплённой шапки; если блок подгружается запросом, ждём его.

const HEADER_OFFSET = 84;
const ANCHOR_WAIT_MS = 2500;

function scrollToAnchor(id: string) {
  const startedAt = Date.now();

  const step = () => {
    const target = document.getElementById(id);
    if (target) {
      const top = target.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
      window.scrollTo({ top: Math.max(top, 0), left: 0, behavior: 'smooth' });
      // Фокус нужен для клавиатуры и скринридеров: иначе переход по якорю
      // остаётся «немым» (WCAG 2.4.3).
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      return;
    }
    if (Date.now() - startedAt < ANCHOR_WAIT_MS) window.setTimeout(step, 100);
  };

  step();
}

export function ScrollManager() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (hash) {
      scrollToAnchor(decodeURIComponent(hash.slice(1)));
      return;
    }
    if (navigationType === 'POP') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, hash, navigationType]);

  return null;
}
