import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type PublicDocument, type PublicPage, api, formatMoscowDate } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, TableOfContents, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Положение о конкурсе: действующая редакция и Приложения № 1–14
// (ТЗ 08, п. 2.1 и 3.7; ТЗ 02, п. 12–13).
//
// PDF не только скачивается, но и открывается отдельно: у каждого документа есть
// ссылка в новой вкладке, а у Положения — кнопка скачивания и просмотр на
// странице. Если публичного файла нет, страница говорит об этом прямо.

const TOC_ITEMS = [
  { id: 'regulation', title: 'Действующая редакция' },
  { id: 'appendices', title: 'Приложения № 1–14' },
];

interface AppendixRow {
  id: number;
  title: string;
  number: string | null;
  name: string;
  url: string | null;
}

/** «Приложение № 10. Согласие…» → номер и название без номера. */
function parseAppendix(title: string): { number: string | null; name: string } {
  const match = /^Приложение\s+№\s*(\d+)\.\s*(.*)$/.exec(title);
  if (!match) return { number: null, name: title };
  return { number: match[1] ?? null, name: match[2] ?? title };
}

export function RegulationsPage() {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: page?.seo_title ?? 'Положение о конкурсе',
    description:
      page?.seo_description ??
      'Положение о конкурсе «Лидеры\u00A0права\u00A0– 2027» и Приложения № 1–14: действующая редакция, версия, просмотр и скачивание PDF.',
    path: '/about/regulations',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'О конкурсе', path: '/about' },
      { name: 'Положение о конкурсе', path: '/about/regulations' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.page('about-regulations');
        if (active) setPage(data);
      } catch {
        // Страница ещё не заполнена в админке — показываем текст по умолчанию.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.documents();
        if (active) setDocuments(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить документы.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const regulation = documents.find((document) => document.type === 'regulation') ?? null;
  const regulationUrl = regulation ? regulation.external_url ?? regulation.file_url : null;

  const appendices = useMemo<AppendixRow[]>(
    () =>
      documents
        .filter((document) => document.type === 'appendix')
        .map((document) => {
          const parsed = parseAppendix(document.title);
          return {
            id: document.id,
            title: document.title,
            number: parsed.number,
            name: parsed.name,
            url: document.external_url ?? document.file_url,
          };
        })
        .sort((a, b) => {
          const left = a.number ? Number(a.number) : Number.POSITIVE_INFINITY;
          const right = b.number ? Number(b.number) : Number.POSITIVE_INFINITY;
          return left - right || a.name.localeCompare(b.name, 'ru');
        }),
    [documents]
  );

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="О конкурсе"
        title={page?.title ?? 'Положение о конкурсе'}
        lead="Действующая редакция Положения и Приложения № 1–14. PDF открывается в новой вкладке и скачивается файлом."
      />

      {page?.body ? (
        <Prose>
          <p className="whitespace-pre-line">{page.body}</p>
        </Prose>
      ) : null}

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        <TableOfContents items={TOC_ITEMS} />

        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <div id="regulation" className="scroll-mt-24">
            <Section
              title="Действующая редакция"
              description={
                regulation
                  ? `Версия ${regulation.version}, редакция от ${formatMoscowDate(regulation.revision_date)}.`
                  : 'Редакция Положения, с которой соглашается команда при подаче заявки.'
              }
            >
              {loading ? (
                <p role="status">Загружаем документы…</p>
              ) : error ? (
                <Alert tone="warning" title="Документы недоступны">
                  {error} Сведения о действующей редакции появятся после восстановления связи с сервером.
                </Alert>
              ) : !regulation ? (
                <p className="max-w-measure text-sm text-muted">
                  Файл Положения готовится к публикации: действующая редакция появится после утверждения. Вопросы —{' '}
                  <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
                    lidery.prava@mail.ru
                  </a>
                  .
                </p>
              ) : regulationUrl ? (
                <div className="flex flex-col gap-4">
                  <p className="max-w-measure text-sm">{regulation.title}</p>
                  <object
                    data={regulationUrl}
                    type="application/pdf"
                    className="h-[70vh] w-full border border-border"
                    aria-label={`Положение о конкурсе «Лидеры\u00A0права\u00A0– 2027», версия ${regulation.version}`}
                  >
                    <p className="p-4 text-sm">
                      Просмотр PDF недоступен в браузере.{' '}
                      <a
                        href={regulationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline underline-offset-2"
                      >
                        Открыть Положение в новой вкладке
                      </a>
                      .
                    </p>
                  </object>
                  <div className="flex flex-wrap gap-3">
                    <ActionLink to={regulationUrl} external>
                      Открыть PDF
                    </ActionLink>
                    <a
                      href={regulationUrl}
                      download
                      className="mono-label inline-flex min-h-[44px] items-center border border-border-strong px-5 hover:border-accent hover:text-accent"
                    >
                      Скачать
                    </a>
                  </div>
                  <p className="max-w-measure text-sm text-muted">
                    {regulation.requires_acceptance
                      ? 'При подаче заявки система фиксирует версию Положения, с которой согласилась команда.'
                      : 'Редакция опубликована для ознакомления.'}
                  </p>
                </div>
              ) : (
                <p className="max-w-measure text-sm text-muted">
                  Действующая редакция утверждена (версия {regulation.version}, редакция от{' '}
                  {formatMoscowDate(regulation.revision_date)}), но файл ещё не опубликован. При подаче заявки
                  система фиксирует версию документа, с которой согласилась команда.
                </p>
              )}
            </Section>
          </div>

          <div id="appendices" className="scroll-mt-24">
            <Section
              title={`Приложения № 1–14${appendices.length > 0 ? ` (${appendices.length})` : ''}`}
              description="Формы заявки и согласий, требования к тексту законопроекта, пояснительной записке и видеоролику, регламент дебатов, форма апелляционного заявления."
            >
              {loading ? (
                <p role="status">Загружаем приложения…</p>
              ) : error ? (
                <Alert tone="warning" title="Приложения недоступны">
                  {error} Список приложений появится после восстановления связи с сервером.
                </Alert>
              ) : appendices.length === 0 ? (
                <Alert tone="info" title="Приложения пока не опубликованы">
                  Приложения публикуются вместе с Положением. Формы согласий участник оформляет электронно при
                  подаче заявки. Вопросы —{' '}
                  <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
                    lidery.prava@mail.ru
                  </a>
                  .
                </Alert>
              ) : (
                <>
                  <ResponsiveTable
                    caption="Приложения к Положению о конкурсе"
                    columns={['Приложение', 'Название', 'Файл']}
                    rows={appendices}
                    rowKey={(row) => row.id}
                    renderCell={(row, index) => {
                      if (index === 0) return row.number ? `Приложение № ${row.number}` : '—';
                      if (index === 1) return row.name;
                      return row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Открыть PDF: ${row.title}`}
                          className="text-accent underline underline-offset-2"
                        >
                          Открыть PDF
                        </a>
                      ) : (
                        <span className="text-muted">файл готовится</span>
                      );
                    }}
                  />
                  <p className="mt-4 text-sm text-muted">
                    Приложения № 10–13 — формы согласий: они оформляются электронно при подаче заявки, а согласие
                    законного представителя дополнительно загружается сканом.
                  </p>
                </>
              )}
            </Section>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted">
        Все документы конкурса, включая юридические, — в разделе{' '}
        <Link to="/documents" className="text-accent underline underline-offset-2">
          «Документы»
        </Link>
        . Вопросы по документам —{' '}
        <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
          lidery.prava@mail.ru
        </a>
        .
      </p>
    </main>
  );
}
