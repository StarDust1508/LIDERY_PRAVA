import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, DOCUMENT_TYPE_TITLES, type PublicDocument, api, formatMoscowDate } from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Страницы юридических документов: /legal/offer, /legal/privacy, /legal/terms,
// /legal/cookies, /legal/jury-regulations, /legal/mailing-consent.
//
// Документы написаны от имени Ассоциации и до утверждения Правлением хранятся
// неопубликованными: публичный API их не отдаёт, поэтому страница честно
// сообщает, что документ на утверждении, вместо того чтобы показывать проект
// как действующую редакцию.

const PATH_TO_TYPE: Record<string, string> = {
  offer: 'offer',
  privacy: 'privacy_policy',
  terms: 'terms',
  cookies: 'cookies_policy',
  'jury-regulations': 'jury_regulations',
  'mailing-consent': 'mailing_consent',
};

const TYPE_SUMMARY: Record<string, string> = {
  offer: 'Условия участия в конкурсе: предмет договора, акцепт подачей заявки, права и обязанности сторон, интеллектуальные права и ответственность.',
  privacy_policy:
    'Какие персональные данные обрабатывает оператор, с какими целями, на каком основании, сколько хранит и как субъект может отозвать согласие.',
  terms: 'Правила использования сайта конкурса, права и обязанности пользователя, ограничения и ответственность.',
  cookies_policy:
    'Какие cookie-файлы использует сайт, для чего они нужны, как отказаться от аналитических файлов и что это меняет.',
  jury_regulations:
    'Порядок работы Конкурсной комиссии и Жюри, требования к членам, правила голосования и урегулирование конфликта интересов.',
  mailing_consent:
    'Отдельное необязательное согласие на информационные и новостные сообщения; отказ не влияет на участие в конкурсе.',
};

export function LegalPage() {
  const params = useParams();
  const slug = params.type ?? '';
  const documentType = PATH_TO_TYPE[slug];
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const title = documentType ? DOCUMENT_TYPE_TITLES[documentType] ?? 'Документ' : 'Документ';

  useSeo({
    title,
    description: documentType ? TYPE_SUMMARY[documentType] ?? 'Юридический документ конкурса.' : 'Юридический документ конкурса.',
    path: `/legal/${slug}`,
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Документы', path: '/documents' },
      { name: title, path: `/legal/${slug}` },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.documents();
        if (active) setDocuments(data);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить документ.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!documentType) {
    return (
      <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-12">
        <Alert tone="warning" title="Документ не найден">
          Проверьте адрес или откройте список документов конкурса.
        </Alert>
        <Link to="/documents" className="text-accent underline underline-offset-2">
          Все документы
        </Link>
      </main>
    );
  }

  const document = documents.find((item) => item.type === documentType);

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Документы конкурса</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">{document?.title ?? title}</h1>
        {document ? (
          <p className="mt-2 text-sm text-muted">
            Версия {document.version} · редакция от {formatMoscowDate(document.revision_date)}
          </p>
        ) : null}
      </header>

      {error ? <Alert tone="warning">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем документ…</p>
      ) : document ? (
        <SectionCard title="Текст документа" description="Скачиваемая версия совпадает по тексту со страницей.">
          {document.external_url || document.file_url ? (
            <div className="flex flex-col gap-4">
              <object
                data={document.external_url ?? document.file_url ?? ''}
                type="application/pdf"
                className="h-[70vh] w-full border border-border"
                aria-label={document.title}
              >
                <p className="p-4 text-sm">
                  Просмотр PDF недоступен в браузере.{' '}
                  <a className="text-accent underline underline-offset-2" href={document.external_url ?? document.file_url ?? '#'}>
                    Скачать документ
                  </a>
                  .
                </p>
              </object>
              <a
                className="text-sm text-accent underline underline-offset-2"
                href={document.external_url ?? document.file_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть в новой вкладке
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted">Файл документа готовится к публикации.</p>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Документ на утверждении" description="Публикуется после решения Правления Ассоциации.">
          <p className="max-w-measure text-sm">{TYPE_SUMMARY[documentType]}</p>
          <p className="mt-4 max-w-measure text-sm text-muted">
            Документ подготовлен от имени Ассоциации выпускников СЮИ – СГАП – СГЮА и находится на утверждении. До
            публикации действующей редакции согласия участников оформляются электронно при подаче заявки по формам
            Приложений № 10–13 к Положению.
          </p>
          <p className="mt-4 text-sm">
            <Link to="/documents" className="text-accent underline underline-offset-2">
              Документы конкурса
            </Link>
            {' · '}
            <a href="mailto:ssla_av@mail.ru" className="text-accent underline underline-offset-2">
              ssla_av@mail.ru
            </a>
          </p>
        </SectionCard>
      )}
    </main>
  );
}
