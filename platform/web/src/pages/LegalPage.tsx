import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, DOCUMENT_TYPE_TITLES, type PublicDocument, api, formatMoscowDate } from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useTrailLabel } from '@/components/Breadcrumbs';

// Страницы юридических документов конкурса (ТЗ 08, п. 2.1).
//
// Адреса страниц — из карты ТЗ; типы документов в базе называются иначе,
// поэтому соответствие задано таблицей: /legal/pdn-consent — это Приложение
// № 10 к Положению (согласие на обработку персональных данных), а не отдельный
// текст. Согласия и лицензия живут приложениями, поэтому ведут на приложение.
//
// Документы написаны от имени Ассоциации и до утверждения Правлением хранятся
// неопубликованными: публичный API их не отдаёт, поэтому страница честно
// сообщает, что документ на утверждении, вместо того чтобы показывать проект
// как действующую редакцию.

type DocRef = { kind: 'type'; value: string } | { kind: 'appendix'; value: string };

const PATH_TO_DOC: Record<string, DocRef> = {
  offer: { kind: 'type', value: 'offer' },
  privacy: { kind: 'type', value: 'privacy_policy' },
  terms: { kind: 'type', value: 'terms' },
  cookies: { kind: 'type', value: 'cookies_policy' },
  'jury-regulations': { kind: 'type', value: 'jury_regulations' },
  'mailing-consent': { kind: 'type', value: 'mailing_consent' },
  // Согласия и лицензия — это приложения к Положению (ТЗ 02, п. 13).
  'pdn-consent': { kind: 'appendix', value: '10' },
  'pdn-consent-minor': { kind: 'appendix', value: '11' },
  'distribution-consent': { kind: 'appendix', value: '12' },
  'media-license': { kind: 'appendix', value: '13' },
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
  appendix_10:
    'Согласие участника на обработку персональных данных. Оформляется электронно при подаче заявки: фиксируются дата, время, сетевой адрес и версия текста.',
  appendix_11:
    'Согласие законного представителя для участников младше 18 лет. Требует и электронной отметки, и скана подписанного бланка: согласие даёт родитель или опекун, который не является пользователем сайта.',
  appendix_12:
    'Согласие на распространение персональных данных. Оформляется по каждой категории отдельно: участник выбирает «разрешаю» или «не разрешаю» по каждой строке.',
  appendix_13:
    'Согласие на использование изображения и лицензия на конкурсные материалы: без него работа публикуется обезличенно.',
};

/** Номер приложения из названия вида «Приложение № 10. Согласие…». */
function appendixNumber(document: PublicDocument): string | null {
  const match = document.title.match(/Приложение\s*№\s*(\d+)/i);
  return match?.[1] ?? null;
}

export function LegalPage() {
  const params = useParams();
  const slug = params.type ?? '';
  const reference = PATH_TO_DOC[slug];
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fallbackTitle =
    reference?.kind === 'appendix'
      ? DOCUMENT_TYPE_TITLES[`appendix_${reference.value}`] ?? `Приложение № ${reference.value}`
      : reference
        ? DOCUMENT_TYPE_TITLES[reference.value] ?? 'Документ'
        : 'Документ';

  const document = reference
    ? reference.kind === 'type'
      ? documents.find((item) => item.type === reference.value)
      : documents.find((item) => item.type === 'appendix' && appendixNumber(item) === reference.value)
    : undefined;

  const title = document?.title ?? fallbackTitle;
  useTrailLabel(document ? title : fallbackTitle);

  useSeo({
    title: fallbackTitle,
    description:
      (reference?.kind === 'appendix'
        ? TYPE_SUMMARY[`appendix_${reference.value}`]
        : reference && TYPE_SUMMARY[reference.value]) ?? 'Юридический документ конкурса «Лидеры права – 2027».',
    path: `/legal/${slug}`,
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Документы', path: '/documents' },
      { name: fallbackTitle, path: `/legal/${slug}` },
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

  if (!reference) {
    return (
      <main className="mx-auto flex max-w-container flex-col gap-6 px-6 py-12">
        <Alert tone="warning" title="Документ не найден">
          Проверьте адрес или откройте список документов конкурса.
        </Alert>
        <ActionLink to="/documents" variant="secondary">
          Все документы
        </ActionLink>
      </main>
    );
  }

  const fileUrl = document?.external_url ?? document?.file_url ?? null;
  const summary =
    (reference.kind === 'appendix'
      ? TYPE_SUMMARY[`appendix_${reference.value}`]
      : TYPE_SUMMARY[reference.value]) ?? 'Документ конкурса.';

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Документы конкурса"
        title={title}
        lead={summary}
        actions={
          fileUrl ? (
            <>
              <ActionLink to={fileUrl} external>
                Открыть PDF
              </ActionLink>
              <a
                href={fileUrl}
                download
                className="mono-label inline-flex min-h-[44px] items-center border border-border-strong px-5 hover:border-accent hover:text-accent"
              >
                Скачать
              </a>
            </>
          ) : null
        }
      />

      {document ? (
        <p className="-mt-4 text-sm text-muted">
          Версия {document.version} · редакция от {formatMoscowDate(document.revision_date)}
        </p>
      ) : null}

      {error ? <Alert tone="warning">{error}</Alert> : null}

      {loading ? (
        <p role="status">Загружаем документ…</p>
      ) : document ? (
        <>
          {reference.kind === 'appendix' && reference.value === '11' ? (
            <Alert tone="info" title="Как оформляется это согласие">
              Участники младше 18 лет дают согласие через законного представителя: электронная отметка в мастере
              подачи заявки и скан подписанного бланка. Без скана заявка не уходит в техническую проверку.
            </Alert>
          ) : null}
          {reference.kind === 'appendix' && reference.value === '12' ? (
            <Alert tone="info" title="Согласие по категориям">
              Решение принимается отдельно по каждой категории распространения. Отказ не влияет на участие в конкурсе,
              но работа публикуется обезличенно.
            </Alert>
          ) : null}

          <Section title="Текст документа" description="Скачиваемая версия совпадает по тексту со страницей.">
            {fileUrl ? (
              <div className="flex flex-col gap-4">
                <object
                  data={fileUrl}
                  type="application/pdf"
                  className="h-[70vh] w-full border border-border"
                  aria-label={title}
                >
                  <Prose>
                    <p>
                      Просмотр PDF недоступен в браузере.{' '}
                      <a className="text-accent underline underline-offset-2" href={fileUrl}>
                        Скачать документ
                      </a>
                      .
                    </p>
                  </Prose>
                </object>
                <a
                  className="text-sm text-accent underline underline-offset-2"
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть в новой вкладке
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted">Файл документа готовится к публикации.</p>
            )}
          </Section>
        </>
      ) : (
        <Section title="Документ на утверждении" description="Публикуется после решения Правления Ассоциации.">
          <Prose>
            <p>{summary}</p>
            <p className="text-muted">
              Документ подготовлен от имени Ассоциации выпускников СЮИ – СГАП – СГЮА и находится на утверждении. До
              публикации действующей редакции согласия участников оформляются электронно при подаче заявки по формам
              Приложений № 10–13 к Положению; их тексты доступны в разделе{' '}
              <Link to="/documents" className="text-accent underline underline-offset-2">
                «Документы»
              </Link>
              .
            </p>
            <p>
              Вопросы по документу:{' '}
              <a href="mailto:lidery.prava@mail.ru" className="text-accent underline underline-offset-2">
                lidery.prava@mail.ru
              </a>
            </p>
          </Prose>
        </Section>
      )}
    </main>
  );
}
