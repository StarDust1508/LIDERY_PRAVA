import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type MaterialRequirement,
  type PublicDocument,
  api,
  formatMoscowDate,
  formatMoscowHuman,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, TableOfContents, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Конкурсные материалы (ТЗ 08, п. 2.1; ТЗ 02, п. 5).
//
// Состав комплекта по трём этапам и сроки приходят из material_requirements —
// того же справочника, по которому сервер проверяет заявку. Поэтому страница не
// может разойтись с приёмом: Оргкомитет меняет состав в админке, а не в тексте.
// Правила приёма материалов приведены по пункту 5.4 Положения.

interface StageGroup {
  id: string;
  title: string;
  items: MaterialRequirement[];
  closeAt: string | null;
}

const STAGES: ReadonlyArray<{ value: 'selection' | 'stage1' | 'final'; id: string; title: string }> = [
  { value: 'selection', id: 'selection', title: 'Отборочный этап' },
  { value: 'stage1', id: 'stage1', title: 'Первый этап' },
  { value: 'final', id: 'final', title: 'Второй (финальный) этап' },
];

const ACCEPTANCE_RULES: readonly string[] = [
  'Дата подачи заявки — дата поступления конкурсных материалов в электронную форму на сайте (п. 7.3 Положения).',
  'Техническая проверка (п. 7.4): основания для недопуска — просрочка, неполный комплект, несоответствие требованиям к участнику, несоответствие направлениям конкурса, запрещённое содержание, очевидное противоречие Конституции Российской Федерации, оригинальность текста менее 70 процентов по «Антиплагиату».',
  'Устранимые недостатки оформления (п. 7.5): Оргкомитет однократно предлагает устранить их в срок не более 2 рабочих дней. Замечание с дедлайном появляется в личном кабинете команды.',
  'Изменение содержания законотворческой инициативы после окончания приёма заявок запрещено (п. 7.5).',
  'Ссылки на облачные хранилища допускаются только на сервисы, зарегистрированные в Российской Федерации (п. 14.4): «ВКонтакте», Яндекс.Диск, Облако Mail.ru, Rutube, Дзен, Одноклассники.',
  'Размер одного загружаемого файла — до 25 МБ. Форматы — .docx и .pdf для текстовых материалов, .pdf или изображение для сканов.',
  'Имя файла оформляется по шаблону «Команда_Документ» (Приложение № 6, п. 3). Заявку по форме Приложения № 1 система формирует сама — загружать её отдельным файлом не нужно.',
];

function formatCell(value: string): string {
  return value.toUpperCase();
}

export function MaterialsPage() {
  const [groups, setGroups] = useState<StageGroup[]>([]);
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: 'Конкурсные материалы',
    description:
      'Состав конкурсных материалов конкурса «Лидеры права – 2027» по трём этапам: законопроект, пояснительная записка, видеоролик, презентация. Требования к форматам, объёму и срокам приёма (МСК).',
    path: '/participants/materials',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Участникам', path: '/participants' },
      { name: 'Конкурсные материалы', path: '/participants/materials' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [selection, stage1, finalStage, documentsData] = await Promise.all([
          api.materialRequirements('selection'),
          api.materialRequirements('stage1'),
          api.materialRequirements('final'),
          api.documents().catch((): PublicDocument[] => []),
        ]);
        if (!active) return;
        const responses = [selection, stage1, finalStage];
        setGroups(
          STAGES.map((stage, index) => ({
            id: stage.id,
            title: stage.title,
            items: responses[index]?.requirements ?? [],
            closeAt: responses[index]?.application_close_at ?? null,
          }))
        );
        setDocuments(documentsData);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить состав конкурсных материалов.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const consents = documents.filter(
    (document) => document.type === 'appendix' && /Приложение № 1[0-3]\./.test(document.title)
  );

  const stage1 = groups.find((group) => group.id === 'stage1');
  const videoLinkDue = stage1?.items[0]?.due_at ?? stage1?.closeAt ?? null;

  const toc = [
    { id: 'composition', title: 'Состав по этапам' },
    ...groups.map((group) => ({ id: group.id, title: group.title })),
    { id: 'rules', title: 'Правила приёма' },
    { id: 'consents', title: 'Согласия' },
  ];

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Участникам"
        title="Конкурсные материалы"
        lead="Состав конкурсных материалов зависит от этапа. Комплект отборочного этапа прикладывается к заявке на сайте, ссылка на видеоролик первого этапа направляется после публикации во «ВКонтакте», презентация — перед финалом."
        actions={
          <>
            <ActionLink to="/apply">Подать заявку</ActionLink>
            <ActionLink to="/participants/video-requirements" variant="secondary">
              Требования к видеоролику
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <TableOfContents items={toc} />

        <div className="flex min-w-0 flex-col gap-8">
          <div id="composition">
            <Section
              title="Состав по этапам"
              description="Комплект и сроки ведёт Оргкомитет в системе конкурса; все сроки указаны по московскому времени."
            >
              <Prose>
                <p className="text-sm">
                  Ниже — полный перечень конкурсных материалов по трём этапам. Обязательность, форматы и сроки
                  обновляются автоматически: если Оргкомитет меняет комплект, страница и личный кабинет команды
                  показывают одно и то же.
                </p>
              </Prose>
            </Section>
          </div>

          {loading ? (
            <p role="status">Загружаем состав конкурсных материалов…</p>
          ) : (
            groups.map((group) => (
              <div id={group.id} key={group.id}>
                <Section
                  title={group.title}
                  description={
                    group.closeAt
                      ? `Срок представления материалов: ${formatMoscowHuman(group.closeAt)}.`
                      : 'Срок представления материалов определяется Оргкомитетом.'
                  }
                >
                  {group.items.length === 0 ? (
                    <p className="text-sm text-muted">
                      Состав комплекта этого этапа ещё не опубликован. Загляните позже или задайте вопрос через раздел
                      «Контакты».
                    </p>
                  ) : (
                    <ResponsiveTable
                      caption={`Конкурсные материалы: ${group.title}`}
                      columns={['Материал', 'Обязательность', 'Требования к формату и объёму', 'Срок (МСК)']}
                      rows={group.items}
                      rowKey={(row) => row.type}
                      renderCell={(row, index) => {
                        if (index === 0) {
                          return (
                            <span>
                              <span className="font-medium">{row.title}</span>
                              {row.description ? <span className="mt-1 block text-muted">{row.description}</span> : null}
                            </span>
                          );
                        }
                        if (index === 1) {
                          return (
                            <span>
                              {row.is_required ? 'Обязательный' : 'Необязательный'}
                              {row.max_files > 1 ? (
                                <span className="mt-1 block text-muted">до {row.max_files} файлов</span>
                              ) : null}
                            </span>
                          );
                        }
                        if (index === 2) {
                          const extensions =
                            row.allowed_extensions.length > 0
                              ? row.allowed_extensions.map(formatCell).join(', ')
                              : 'ссылка на публикацию, файл не загружается';
                          return (
                            <span>
                              {extensions}
                              {row.name_template ? (
                                <span className="mt-1 block text-muted">Имя файла: «{row.name_template}»</span>
                              ) : null}
                              <span className="mt-1 block text-muted">до 25 МБ на файл</span>
                            </span>
                          );
                        }
                        return row.due_at ? formatMoscowHuman(row.due_at) : formatMoscowHuman(group.closeAt);
                      }}
                    />
                  )}
                </Section>
              </div>
            ))
          )}

          <div id="rules">
            <Section
              title="Правила приёма конкурсных материалов"
              description="Пункты 7.3–7.5 и 14.4 Положения."
            >
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
                {ACCEPTANCE_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <p className="mt-4 max-w-measure text-sm text-muted">
                Загрузить или заменить материал можно до дедлайна этапа; после дедлайна — только по замечанию
                Оргкомитета в пределах срока досдачи.
                {videoLinkDue
                  ? ` Ссылка на видеоролик первого этапа направляется в Оргкомитет не позднее ${formatMoscowHuman(videoLinkDue)}.`
                  : ''}
              </p>
            </Section>
          </div>

          <div id="consents">
            <Section
              title="Согласия"
              description={
                consents[0]?.revision_date
                  ? `Приложения № 10–13 к Положению. Редакция от ${formatMoscowDate(consents[0].revision_date)}.`
                  : 'Приложения № 10–13 к Положению.'
              }
            >
              {consents.length === 0 ? (
                <p className="text-sm text-muted">
                  Согласия оформляются электронно при подаче заявки. Тексты бланков доступны в разделе{' '}
                  <Link to="/documents" className="text-accent underline underline-offset-2">
                    «Документы»
                  </Link>
                  .
                </p>
              ) : (
                <ul className="flex flex-col gap-3 text-sm">
                  {consents.map((document) => {
                    const url = document.file_url ?? document.external_url;
                    return (
                      <li
                        key={document.id}
                        className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-2"
                      >
                        <span>{document.title}</span>
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
                          <span className="text-muted">файл готовится</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <Prose>
                <p className="mt-4 text-sm">
                  Согласия на обработку персональных данных (Приложения № 10–12) оформляются электронной отметкой в
                  мастере подачи. Для участников младше 18 лет дополнительно нужен скан подписанного согласия законного
                  представителя (Приложение № 11).{' '}
                  <Link to="/documents" className="text-accent underline underline-offset-2">
                    Все документы конкурса
                  </Link>
                  .
                </p>
              </Prose>
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
