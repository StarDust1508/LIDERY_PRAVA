import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type PublicDocument, api, formatMoscowDate } from '@shared/index';
import { PageHeader, Prose, Section } from '@/components/PageBlocks';
import { ArrowLeft, ArrowRight, Download } from '@/components/Icon';
import { useSeo } from '@/lib/seo';

// Приложение к Положению по номеру (ТЗ 08, п. 2.1; ТЗ 09, п. 4).
//
// Приложения № 1–14 лежат в базе как документы типа «appendix» и ведут на общий
// PDF. Раньше страница была заглушкой «Раздел наполняется», хотя документы уже
// опубликованы: посетитель не мог ни прочитать, ни скачать приложение.
//
// Страница показывает название приложения, редакцию, сам PDF и переходы к
// соседним приложениям — по списку удобно идти подряд.

const FIRST = 1;
const LAST = 14;

/** Номер приложения из названия вида «Приложение № 10. Согласие…». */
function numberOf(title: string): number | null {
  const match = title.match(/Приложение\s*№\s*(\d+)/i);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

export function AppendixPage() {
  const params = useParams();
  const requested = Number.parseInt(params.number ?? '', 10);
  const number = Number.isNaN(requested) ? null : requested;

  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useSeo({
    title: number ? `Приложение № ${number} к Положению` : 'Приложение к Положению',
    description:
      'Приложения № 1–14 к Положению о конкурсе «Лидеры права – 2027»: формы заявки и согласий, требования к материалам, регламенты этапов.',
    path: number ? `/legal/appendix/${number}` : '/documents',
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.documents();
        if (active) setDocuments(data);
      } catch {
        if (active) setError('Не удалось загрузить приложения. Обновите страницу позже.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const appendices = documents
    .filter((document) => document.type === 'appendix')
    .map((document) => ({ document, number: numberOf(document.title) }))
    .filter((item): item is { document: PublicDocument; number: number } => item.number !== null)
    .sort((a, b) => a.number - b.number);

  const current = number === null ? undefined : appendices.find((item) => item.number === number)?.document;
  const fileUrl = current ? current.external_url ?? current.file_url ?? null : null;
  const previous = number !== null && number > FIRST ? number - 1 : null;
  const next = number !== null && number < LAST ? number + 1 : null;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Документы"
        // В заголовке — номер приложения: полное название документа занимает
        // несколько строк и уместнее в подписи под заголовком.
        title={number ? `Приложение № ${number}` : 'Приложение к Положению'}
        lead={
          current
            ? `${current.title}. Редакция от ${formatMoscowDate(current.revision_date)}, версия ${current.version}.`
            : undefined
        }
      />

      {loading ? (
        <Section>
          <p className="loading-note">Загружаем приложения…</p>
        </Section>
      ) : null}

      {error ? (
        <Section>
          <Prose>
            <p>{error}</p>
          </Prose>
        </Section>
      ) : null}

      {!loading && !error && !current ? (
        <Section
          title="Приложение не найдено"
          description={number ? `Приложение № ${number} не опубликовано.` : 'Номер приложения не указан.'}
        >
          <Prose>
            <p>
              Все опубликованные приложения собраны в разделе «Документы». Если нужно приложение, которого там
              нет, напишите в Оргкомитет — контакты в разделе «Контакты».
            </p>
            <p>
              <Link to="/documents">Перейти к документам конкурса</Link>
            </p>
          </Prose>
        </Section>
      ) : null}

      {current ? (
        <Section
          title="Текст приложения"
          description="Приложения к Положению опубликованы одним файлом: нужное приложение открывается по номеру."
        >
          {fileUrl ? (
            <div className="flex flex-col gap-4">
              <object
                data={fileUrl}
                type="application/pdf"
                className="h-[70vh] w-full border border-border"
                aria-label={current.title}
              >
                <p className="p-4 text-sm">
                  Просмотр PDF недоступен в браузере.{' '}
                  <a className="text-accent underline underline-offset-2" href={fileUrl}>
                    Скачать файл приложений
                  </a>
                  .
                </p>
              </object>
              <a className="btn btn-ghost mono" href={fileUrl} target="_blank" rel="noopener noreferrer">
                <Download size={16} />
                Скачать приложения
              </a>
            </div>
          ) : (
            <Prose>
              <p>Файл приложения пока не загружен. Обратитесь в Оргкомитет через раздел «Контакты».</p>
            </Prose>
          )}
        </Section>
      ) : null}

      {appendices.length > 0 ? (
        <Section title="Приложения № 1–14" description="Перечень приложений к Положению о конкурсе.">
          <ol className="flex flex-col gap-2 text-sm">
            {appendices.map((item) => (
              <li key={item.number}>
                <Link
                  to={`/legal/appendix/${item.number}`}
                  aria-current={item.number === number ? 'page' : undefined}
                  className={item.number === number ? 'font-semibold text-accent' : undefined}
                >
                  {item.document.title}
                </Link>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <nav className="pagenav" aria-label="Переход между приложениями">
        {previous !== null ? (
          <Link to={`/legal/appendix/${previous}`} className="pagenav-link pagenav-prev">
            <span className="pagenav-arrow">
              <ArrowLeft size={22} />
            </span>
            <span className="pagenav-text">
              <span className="mono">Назад</span>
              <strong>Приложение № {previous}</strong>
            </span>
          </Link>
        ) : (
          <span className="pagenav-spacer" />
        )}
        {next !== null ? (
          <Link to={`/legal/appendix/${next}`} className="pagenav-link pagenav-next">
            <span className="pagenav-text">
              <span className="mono">Далее</span>
              <strong>Приложение № {next}</strong>
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
    </main>
  );
}
