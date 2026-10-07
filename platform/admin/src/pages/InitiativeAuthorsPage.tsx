import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminApiError, adminApi } from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, SelectField, TextField } from '@shared/index';

// Карточка авторов инициативы (ТЗ 07, п. 2.14а).
//
// Авторы публикуются выборочно: отметка «публиковать» соответствует согласию по
// категориям Приложения № 12, поэтому Оргкомитет отмечает каждого автора
// отдельно, а не всех сразу. Пока согласия нет, работа публикуется обезличенно —
// это и показывает колонка состояния.

interface InitiativeOption {
  id: number;
  title: string;
  team_name?: string | null;
  archive_year?: number | null;
  is_published?: boolean;
}

interface AuthorRow {
  id: number;
  full_name: string;
  organization: string | null;
  region: string | null;
  is_published: boolean;
  sort_order: number;
}

export function InitiativeAuthorsPage() {
  const [initiatives, setInitiatives] = useState<InitiativeOption[]>([]);
  const [initiativeId, setInitiativeId] = useState('');
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', organization: '', region: '', is_published: false });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await adminApi.resourceList<InitiativeOption>('initiatives', { limit: 200 });
        if (active) setInitiatives(rows);
      } catch (caught) {
        if (active) setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить архив.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const loadAuthors = useCallback(async (id: number) => {
    setAuthorsLoading(true);
    setError(null);
    try {
      setAuthors(await adminApi.initiativeAuthors(id));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить авторов.');
    } finally {
      setAuthorsLoading(false);
    }
  }, []);

  async function addAuthor() {
    if (initiativeId === '' || draft.full_name.trim().length < 3) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.addInitiativeAuthor(Number(initiativeId), {
        full_name: draft.full_name.trim(),
        organization: draft.organization.trim() || null,
        region: draft.region.trim() || null,
        is_published: draft.is_published,
      });
      setDraft({ full_name: '', organization: '', region: '', is_published: false });
      setNotice('Автор добавлен.');
      await loadAuthors(Number(initiativeId));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось добавить автора.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePublished(author: AuthorRow) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.updateInitiativeAuthor(Number(initiativeId), author.id, { is_published: !author.is_published });
      setNotice(
        !author.is_published
          ? `Автор «${author.full_name}» будет опубликован.`
          : `Автор «${author.full_name}» скрыт: публикация обезличенная.`
      );
      await loadAuthors(Number(initiativeId));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось изменить отметку публикации.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAuthor(author: AuthorRow) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.deleteInitiativeAuthor(Number(initiativeId), author.id);
      setNotice(`Автор «${author.full_name}» удалён из карточки.`);
      await loadAuthors(Number(initiativeId));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось удалить автора.');
    } finally {
      setBusy(false);
    }
  }

  const selected = initiatives.find((row) => String(row.id) === initiativeId) ?? null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow="Контент сайта"
        title="Авторы инициатив"
        lead="Отметка «публиковать» соответствует согласию автора по Приложению № 12: без согласия работа публикуется обезличенно."
      />

      {error ? <Alert tone="danger" title="Не удалось выполнить">{error}</Alert> : null}
      {notice ? <Alert tone="success" title="Готово">{notice}</Alert> : null}

      <SectionCard title="Инициатива" description="Выберите работу, чтобы увидеть и дополнить список авторов.">
        <SelectField
          id="authors-initiative"
          label="Работа"
          value={initiativeId}
          onChange={(event) => {
            const value = event.target.value;
            setInitiativeId(value);
            setNotice(null);
            if (value !== '') void loadAuthors(Number(value));
            else setAuthors([]);
          }}
          placeholder={loading ? 'Загружаем архив…' : 'Выберите работу'}
          options={initiatives.map((row) => ({
            value: String(row.id),
            title: `${row.title}${row.team_name ? ` — ${row.team_name}` : ''}${row.archive_year ? ` (${row.archive_year})` : ''}`,
          }))}
        />
        {selected ? (
          <p className="mt-3 text-sm text-muted">
            Состояние публикации: {selected.is_published ? 'опубликована' : 'не опубликована'}.{' '}
            <Link className="underline" to="/initiatives">
              Открыть раздел архива
            </Link>
          </p>
        ) : null}
      </SectionCard>

      {initiativeId !== '' ? (
        <SectionCard title="Авторы" description="Публикуются только отмеченные авторы; остальные остаются в карточке для Оргкомитета.">
          {authorsLoading ? <p role="status">Загружаем авторов…</p> : null}
          {!authorsLoading && authors.length === 0 ? (
            <p className="text-sm text-muted">
              Авторы не заполнены. Если состав известен, добавьте их — это влияет на публикацию работы.
            </p>
          ) : null}
          {authors.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <caption className="sr-only-text">Авторы выбранной инициативы</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4">
                      Фамилия, имя, отчество
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Организация
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Регион
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Публикация
                    </th>
                    <th scope="col" className="py-2">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {authors.map((author) => (
                    <tr key={author.id} className="border-b border-border align-top">
                      <td className="py-2 pr-4">{author.full_name}</td>
                      <td className="py-2 pr-4">{author.organization ?? '—'}</td>
                      <td className="py-2 pr-4">{author.region ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <span className={author.is_published ? 'text-success' : 'text-muted'}>
                          {author.is_published ? 'публикуется' : 'скрыт (нет согласия)'}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="secondary" loading={busy} onClick={() => void togglePublished(author)}>
                            {author.is_published ? 'Скрыть' : 'Публиковать'}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="border-danger text-danger"
                            loading={busy}
                            onClick={() => void removeAuthor(author)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-3">
            <TextField
              id="author-name"
              label="Фамилия, имя, отчество"
              value={draft.full_name}
              onChange={(event) => setDraft((current) => ({ ...current, full_name: event.target.value }))}
              required
            />
            <TextField
              id="author-organization"
              label="Организация"
              value={draft.organization}
              onChange={(event) => setDraft((current) => ({ ...current, organization: event.target.value }))}
            />
            <TextField
              id="author-region"
              label="Регион"
              value={draft.region}
              onChange={(event) => setDraft((current) => ({ ...current, region: event.target.value }))}
            />
            <label className="flex items-start gap-3 text-sm md:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.is_published}
                onChange={(event) => setDraft((current) => ({ ...current, is_published: event.target.checked }))}
              />
              <span>Есть согласие по Приложению № 12 — публиковать автора</span>
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                loading={busy}
                disabled={draft.full_name.trim().length < 3}
                onClick={() => void addAuthor()}
              >
                Добавить автора
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </main>
  );
}
