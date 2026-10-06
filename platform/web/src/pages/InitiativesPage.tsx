import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ACT_LEVELS,
  ApiError,
  type Direction,
  type InitiativeListItem,
  actLevelTitle,
  api,
} from '@shared/index';
import { Alert, Button, SelectField, TextField } from '@shared/index';
import { Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Архив законопроектов (ТЗ 02, п. 14): все инициативы, прошедшие конкурс.
// Публикуются только инициативы, открытые Оргкомитетом; авторы и файлы — при
// согласиях, поэтому в списке их нет вовсе.

export function InitiativesPage() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<InitiativeListItem[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const q = params.get('q') ?? '';
  const year = params.get('year') ?? '';
  const directionId = params.get('direction_id') ?? '';
  const actLevel = params.get('act_level') ?? '';
  const hasFiles = params.get('has_files') ?? '';

  const [searchDraft, setSearchDraft] = useState(q);

  useSeo({
    title: 'Архив законопроектов',
    description:
      'Законотворческие инициативы участников конкурса «Лидеры права»: названия, направления, команды и результаты. Опубликовано по решению Оргкомитета.',
    path: '/initiatives',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Архив законопроектов', path: '/initiatives' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const directionData = await api.directions();
        if (active) setDirections(directionData);
      } catch {
        // Справочник направлений не критичен для списка.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await api.initiatives({
          q: q || undefined,
          year: year ? Number(year) : undefined,
          direction_id: directionId ? Number(directionId) : undefined,
          act_level: actLevel || undefined,
          has_files: hasFiles || undefined,
        });
        if (!active) return;
        setItems(data);
        setYears((current) => {
          const set = new Set(current);
          for (const item of data) if (item.archive_year) set.add(item.archive_year);
          return [...set].sort((a, b) => b - a);
        });
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить архив.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [q, year, directionId, actLevel, hasFiles]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const filtered = useMemo(() => items, [items]);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Прозрачность конкурса</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Архив законопроектов</h1>
        <p className="mt-3 max-w-measure text-muted">
          Инициативы, прошедшие конкурс. Карточки публикуются по решению Оргкомитета и только в объёме согласий
          участников: без согласия на распространение авторы не указываются, без лицензии не отдаются файлы работ.
        </p>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Section title="Поиск и фильтры" description={`Найдено инициатив: ${filtered.length}.`}>
        <form
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateParam('q', searchDraft.trim());
          }}
        >
          <TextField
            id="initiatives-search"
            label="Поиск по названию, команде и аннотации"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Например, цифровые права"
          />
          <SelectField
            id="initiatives-year"
            label="Год конкурса"
            value={year}
            onChange={(event) => updateParam('year', event.target.value)}
            placeholder="Все годы"
            options={years.map((value) => ({ value, title: String(value) }))}
          />
          <SelectField
            id="initiatives-direction"
            label="Направление"
            value={directionId}
            onChange={(event) => updateParam('direction_id', event.target.value)}
            placeholder="Все направления"
            options={directions.map((direction) => ({ value: direction.id, title: direction.title }))}
          />
          <SelectField
            id="initiatives-act-level"
            label="Уровень акта"
            value={actLevel}
            onChange={(event) => updateParam('act_level', event.target.value)}
            placeholder="Любой уровень"
            options={ACT_LEVELS.map((level) => ({ value: level.value, title: level.title }))}
          />
          <SelectField
            id="initiatives-files"
            label="Наличие файлов"
            value={hasFiles}
            onChange={(event) => updateParam('has_files', event.target.value)}
            placeholder="Не важно"
            options={[{ value: 'true', title: 'Только с файлами работ' }]}
          />
          <div className="flex items-end gap-3">
            <Button type="submit" loading={loading}>
              Найти
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearchDraft('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Сбросить
            </Button>
          </div>
        </form>
      </Section>

      {loading ? (
        <p role="status">Загружаем архив…</p>
      ) : filtered.length === 0 ? (
        <Alert tone="info" title="Опубликованных инициатив пока нет">
          Архив пополняется по решению Оргкомитета: инициативы публикуются после завершения этапов и при наличии согласий
          участников. Загляните позже.
        </Alert>
      ) : (
        <ul className="flex flex-col gap-6">
          {filtered.map((item) => (
            <li key={item.id} className="border border-border p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-h3 font-semibold">
                  <Link to={`/initiatives/${item.slug}`} className="hover:text-accent">
                    {item.title}
                  </Link>
                </h2>
                <p className="mono-label text-muted">
                  {item.archive_year ?? '—'} · {item.direction_title ?? 'направление не указано'}
                </p>
              </div>
              {item.annotation ? <p className="mt-3 max-w-measure text-sm text-muted">{item.annotation}</p> : null}
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="mono-label text-muted">Команда</dt>
                  <dd>{item.team_name ?? 'не указана'}</dd>
                </div>
                <div>
                  <dt className="mono-label text-muted">Уровень акта</dt>
                  <dd>{actLevelTitle(item.act_level)}</dd>
                </div>
                <div>
                  <dt className="mono-label text-muted">Результат</dt>
                  <dd>
                    {item.result_place ? `${item.result_place} место` : item.nomination ?? 'не указан'}
                  </dd>
                </div>
                <div>
                  <dt className="mono-label text-muted">Файлы работ</dt>
                  <dd>{item.has_files ? 'доступны' : 'не опубликованы'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
