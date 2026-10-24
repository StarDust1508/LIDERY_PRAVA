import { useEffect, useId, useMemo, useRef, useState } from 'react';

// Поле образовательной организации с поиском по списку вузов РФ, ДНР и ЛНР.
// Список лежит статикой (/universities.json) и грузится один раз: в бандл его
// не зашиваем. Если список недоступен — поле работает как обычный ввод, чтобы
// заявку нельзя было заблокировать сбоем загрузки.

interface University {
  name: string;
  short?: string | null;
  city?: string | null;
}

let cache: University[] | null = null;
let pending: Promise<University[]> | null = null;

function loadUniversities(): Promise<University[]> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetch('/universities.json', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: unknown) => {
        cache = Array.isArray(data)
          ? data.filter((item): item is University => Boolean(item && typeof item === 'object' && 'name' in item))
          : [];
        return cache;
      })
      .catch(() => {
        cache = [];
        return cache;
      });
  }
  return pending;
}

export function UniversityField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  required,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
}) {
  const [universities, setUniversities] = useState<University[]>(cache ?? []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let activeRequest = true;
    void loadUniversities().then((list) => {
      if (activeRequest) setUniversities(list);
    });
    return () => {
      activeRequest = false;
    };
  }, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const result: University[] = [];
    for (const item of universities) {
      const haystack = `${item.name} ${item.short ?? ''} ${item.city ?? ''}`.toLowerCase();
      if (haystack.includes(needle)) result.push(item);
      if (result.length >= 8) break;
    }
    return result;
  }, [universities, query]);

  const listVisible = open && matches.length > 0;

  function select(item: University) {
    onChange(item.name);
    setQuery(item.name);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2" ref={wrapRef}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required ? (
          <span className="text-accent" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listVisible ? `${listId}-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          required={required}
          value={query}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          className={`min-h-[44px] w-full border bg-raised px-3 py-2 text-body ${
            error ? 'border-danger' : 'border-border-strong'
          } disabled:border-border disabled:text-muted`}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && listVisible) {
              event.preventDefault();
              setActive((index) => (index + 1) % matches.length);
            } else if (event.key === 'ArrowUp' && listVisible) {
              event.preventDefault();
              setActive((index) => (index - 1 + matches.length) % matches.length);
            } else if (event.key === 'Enter' && listVisible) {
              event.preventDefault();
              const item = matches[active];
              if (item) select(item);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {listVisible ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto border border-border bg-raised shadow-lg"
          >
            {matches.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-sand text-fg' : 'text-fg'}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(item);
                }}
              >
                <span className="font-medium">{item.name}</span>
                {item.city || item.short ? (
                  <span className="mt-0.5 block text-xs text-muted">
                    {[item.short, item.city].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
