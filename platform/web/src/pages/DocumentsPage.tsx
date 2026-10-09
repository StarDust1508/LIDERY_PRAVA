import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  type PublicDocument,
  api,
  formatMoscowDate,
} from '@shared/index';
import { Alert } from '@shared/index';
import { Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Страница «Документы» (ТЗ 08, п. 2.1 и ТЗ 09, п. 4).
//
// Публикуются только действующие редакции: Положение, Приложения № 1–14 и
// юридические документы. У каждого документа видна версия и дата редакции —
// участник должен понимать, с какой редакцией он соглашается при подаче заявки.

export function DocumentsPage() {
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: 'Документы конкурса',
    description:
      'Положение о конкурсе «Лидеры права – 2027» и Приложения № 1–14, юридические документы сайта: версии и даты редакций, PDF для скачивания.',
    path: '/documents',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Документы', path: '/documents' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.documents();
        if (active) setDocuments(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить список документов.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const regulation = documents.find((document) => document.type === 'regulation');
  const appendices = useMemo(
    () => documents.filter((document) => document.type === 'appendix').sort((a, b) => a.title.localeCompare(b.title, 'ru')),
    [documents]
  );
  const legal = useMemo(
    () => documents.filter((document) => !['regulation', 'appendix'].includes(document.type)),
    [documents]
  );

  const fileUrl = (document: PublicDocument) => document.external_url ?? document.file_url;

  function renderList(items: PublicDocument[]) {
    return (
      <ul className="flex flex-col gap-3 text-sm">
        {items.map((document) => {
          const url = fileUrl(document);
          return (
            <li key={document.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-2">
              <span>{document.title}</span>
              <span className="flex flex-wrap items-baseline gap-3 text-muted">
                <span className="font-mono">
                  {document.version} · {formatMoscowDate(document.revision_date)}
                </span>
                {url ? (
                  <a
                    className="text-accent underline underline-offset-2"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Открыть PDF
                  </a>
                ) : (
                  <span>файл готовится</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Редакция от 4 октября 2026 года</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Документы конкурса</h1>
        <p className="mt-3 max-w-measure text-muted">
          Положение о конкурсе и Приложения № 1–14 определяют правила участия, состав заявки, требования к материалам и
          критерии оценки. При подаче заявки система фиксирует версию документов, с которой согласилась команда.
        </p>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {regulation ? (
        <Section
          title="Положение о конкурсе"
          description={`Версия ${regulation.version}, редакция от ${formatMoscowDate(regulation.revision_date)}.`}
        >
          {regulation.external_url ? (
            <div className="flex flex-col gap-4">
              <object
                data={regulation.external_url}
                type="application/pdf"
                className="h-[70vh] w-full border border-border"
                aria-label="Положение о конкурсе «Лидеры права – 2027»"
              >
                <p className="p-4 text-sm">
                  Просмотр PDF недоступен в браузере.{' '}
                  <a className="text-accent underline underline-offset-2" href={regulation.external_url}>
                    Скачать Положение
                  </a>
                  .
                </p>
              </object>
              <a
                className="text-sm text-accent underline underline-offset-2"
                href={regulation.external_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть Положение в новой вкладке
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted">Файл Положения готовится к публикации.</p>
          )}
        </Section>
      ) : null}

      <Section
        title={`Приложения № 1–14 (${appendices.length})`}
        description="Формы заявки, направлений, требований к материалам, регламент дебатов, оценочный лист и формы согласий. Единый PDF всех приложений."
      >
        {loading ? <p role="status">Загружаем документы…</p> : renderList(appendices)}
      </Section>

      <Section
        title="Юридические документы"
        description="Оферта, обработка персональных данных, пользовательское соглашение, cookie, регламент Жюри. Документы публикуются после утверждения Правлением Ассоциации."
      >
        {legal.length === 0 ? (
          <p className="text-sm text-muted">
            Документы находятся на утверждении Правления Ассоциации. Тексты согласий участник оформляет электронно при
            подаче заявки (Приложения № 10–13).
          </p>
        ) : (
          renderList(legal)
        )}
      </Section>

      <p className="text-sm text-muted">
        Контакт по вопросам документов:{' '}
        <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
          lidery.prava@mail.ru
        </a>
        . Прежняя почта support@lideryprava.ru не используется.
      </p>
    </main>
  );
}
