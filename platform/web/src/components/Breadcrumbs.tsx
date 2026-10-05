import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { trailFor } from '@/app/nav';

// Хлебные крошки внутренних страниц (ТЗ 08, п. 1.3.4).
//
// Состав берётся из структуры навигации, а подпись текущей страницы добавляет
// сама страница: карточка инициативы знает своё название, а разметка — нет.
// Так крошки не расходятся с меню и не требуют правок в двух местах.

interface TrailState {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const TrailContext = createContext<TrailState>({ label: null, setLabel: () => undefined });

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>;
}

/** Подпись текущей страницы в крошках. `null` — страница без своей подписи. */
export function useTrailLabel(label: string | null): void {
  const { setLabel } = useContext(TrailContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { label } = useContext(TrailContext);
  const items = trailFor(pathname);

  if (items.length === 0) return null;

  // Если страница назвала себя сама, последняя крошка из навигации уступает
  // место этому названию: «Главная / Архив законопроектов / Название».
  const trail = label
    ? items.filter((item, index) => !(index === items.length - 1 && item.path === pathname))
    : items;

  return (
    <nav aria-label="Хлебные крошки" className="mx-auto max-w-container px-6 pt-6">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        {trail.map((item, index) => {
          const current = !label && index === trail.length - 1;
          return (
            <li key={`${item.path}-${index}`} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {current ? (
                <span aria-current="page">{item.title}</span>
              ) : (
                <Link to={item.path} className="underline underline-offset-2 hover:text-accent">
                  {item.title}
                </Link>
              )}
            </li>
          );
        })}
        {label ? (
          <li className="flex items-center gap-2">
            {trail.length > 0 ? <span aria-hidden="true">/</span> : null}
            <span aria-current="page">{label}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
