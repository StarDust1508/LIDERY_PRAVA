import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { pageNavFor } from '@/app/nav';
import { ArrowLeft, ArrowRight } from '@/components/Icon';

// Переходы между страницами и возврат к началу.
//
// Прежняя навигация обрывалась: дойдя до конца страницы, участник не понимал,
// куда идти дальше, и возвращался в шапку. Здесь у каждой страницы есть
// «Предыдущая / Следующая» в порядке чтения конкурса, подпись раздела и линия,
// которая прочерчивается при наведении.
//
// Кнопка «наверх» появляется только после прокрутки и не мешает чтению.

export function PageNav({ pathname }: { pathname?: string }) {
  const location = useLocation();
  const current = (pathname ?? location.pathname).replace(/\/+$/, '') || '/';
  const { prev, next } = pageNavFor(current);

  if (!prev && !next) return null;

  return (
    <nav className="pagenav wrap" aria-label="Переход между страницами">
      {prev ? (
        <Link to={prev.path} className="pagenav-link pagenav-prev">
          <span className="pagenav-arrow">
            <ArrowLeft size={22} />
          </span>
          <span className="pagenav-text">
            <span className="mono">Назад</span>
            <strong>{prev.title}</strong>
          </span>
        </Link>
      ) : (
        <span className="pagenav-spacer" />
      )}

      {next ? (
        <Link to={next.path} className="pagenav-link pagenav-next">
          <span className="pagenav-text">
            <span className="mono">Далее</span>
            <strong>{next.title}</strong>
          </span>
          <span className="pagenav-arrow">
            <ArrowRight size={22} />
          </span>
        </Link>
      ) : (
        <span className="pagenav-spacer" />
      )}

      <span className="pagenav-rule" aria-hidden="true" />
    </nav>
  );
}

export function ToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 1400);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      className={`totop${visible ? ' is-visible' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <ArrowLeft size={18} />
      <span>Наверх</span>
    </button>
  );
}
