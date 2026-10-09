import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type MaterialRequirement,
  type PublicCriterion,
  type PublicDocument,
  api,
  formatMoscowHuman,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, TableOfContents, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';

// Требования к видеоролику первого этапа (ТЗ 08, п. 2.1; ТЗ 02, п. 5.2).
//
// Содержание страницы опирается на данные: критерий оценки видеоролика приходит
// из справочника критериев, срок и хэштеги — из требования к комплекту первого
// этапа, текст Приложения № 7 — из документов. Технические параметры, которых в
// данных нет (ориентация кадра, разрешение, объём), не выдумываются: страница
// отправляет команду к Приложению № 7.

export function VideoRequirementsPage() {
  const { data } = useSeason();
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [requirement, setRequirement] = useState<MaterialRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: 'Требования к видеоролику',
    description:
      'Требования к видеоролику первого этапа конкурса «Лидеры права – 2027»: содержание, длительность, публикация во «ВКонтакте» с хэштегами, сроки и критерий оценки Конкурсной комиссии.',
    path: '/participants/video-requirements',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Участникам', path: '/participants' },
      { name: 'Требования к видеоролику', path: '/participants/video-requirements' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [documentsData, criteriaData, requirementsData] = await Promise.all([
          api.documents().catch((): PublicDocument[] => []),
          api.criteria('stage1'),
          api.materialRequirements('stage1'),
        ]);
        if (!active) return;
        setDocuments(documentsData);
        setCriteria(criteriaData);
        setRequirement(requirementsData.requirements.find((item) => item.type === 'video_link') ?? null);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить требования к видеоролику.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const season = data?.season ?? null;
  const videoDocument = documents.find((document) => document.title.includes('Приложение № 7')) ?? null;
  const videoDocumentUrl = videoDocument ? (videoDocument.file_url ?? videoDocument.external_url) : null;
  const videoCriterion = criteria.find((criterion) => criterion.title.toLowerCase().includes('видеоролик')) ?? null;
  const totalScore = criteria.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);
  const publishingDue = requirement?.due_at ?? null;

  const toc = [
    { id: 'content', title: 'Содержание' },
    { id: 'format', title: 'Длительность и формат' },
    { id: 'place', title: 'Где публикуется' },
    { id: 'dates', title: 'Сроки' },
    { id: 'criteria', title: 'Кто оценивает' },
    { id: 'appendix', title: 'Приложение № 7' },
  ];

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Участникам"
        title="Требования к видеоролику"
        lead="Видеоролик представляет команду и её законотворческую инициативу на первом этапе конкурса. Публикация размещается во «ВКонтакте», ссылка направляется в Оргкомитет."
        actions={
          <>
            <ActionLink to="/participants/materials" variant="secondary">
              Конкурсные материалы
            </ActionLink>
            <ActionLink to="/stages/criteria" variant="secondary">
              Критерии оценки
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading ? <p role="status">Загружаем требования к видеоролику…</p> : null}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <TableOfContents items={toc} />

        <div className="flex min-w-0 flex-col gap-8">
          <div id="content">
            <Section title="Что показать в видеоролике" description="Представление команды и законотворческой инициативы.">
              <Prose>
                <p className="text-sm">
                  Видеоролик знакомит Конкурсную комиссию с командой и её законотворческой инициативой. В нём нужно:
                </p>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
                  <li>представить команду и её участников, назвать направление конкурса;</li>
                  <li>сформулировать проблему, на решение которой направлена законотворческая инициатива;</li>
                  <li>показать предлагаемое правовое решение и ожидаемый результат;</li>
                  <li>объяснить, в чём оригинальность подачи идеи и почему инициатива важна.</li>
                </ul>
                <p className="text-sm">
                  Оценивается не только содержание, но и качество подачи: смотрите критерий оценки видеоролика ниже.
                </p>
              </Prose>
            </Section>
          </div>

          <div id="format">
            <Section title="Длительность и формат" description="Пункт 8.2 Положения и Приложение № 7.">
              <ul className="flex flex-col gap-3 text-sm">
                <li>
                  <strong>Длительность — до 5 минут.</strong> Более длинные ролики оцениваются по требованиям
                  Приложения № 7.
                </li>
                <li>
                  <strong>Ориентация кадра</strong> — вертикальная или горизонтальная — устанавливается Приложением № 7.
                  Перед съёмкой откройте Приложение № 7 и проверьте, какой формат требуется: если требование не
                  выполнено, ролик может быть снят с оценки.
                </li>
                <li>
                  <strong>Разрешение, соотношение сторон и объём файла</strong> также определяются Приложением № 7.
                  Требования к параметрам записи в открытых данных сайта не публикуются, поэтому единственный источник —
                  Приложение № 7.
                </li>
              </ul>
              <p className="mt-4 text-sm">
                <Link to="/documents" className="text-accent underline underline-offset-2">
                  Открыть Приложения № 1–14
                </Link>
              </p>
            </Section>
          </div>

          <div id="place">
            <Section title="Где публикуется" description="«ВКонтакте» — официальная площадка первого этапа (п. 8.3).">
              <ul className="flex flex-col gap-3 text-sm">
                <li>Публикация размещается на стене личной страницы или в сообществе команды во «ВКонтакте».</li>
                <li>
                  В описании публикации указываются хэштег{' '}
                  <span className="font-mono">#Лидеры_права_2027</span>, название команды и название законопроекта.
                </li>
                <li>
                  Для участия в номинации «Приз зрительских симпатий» дополнительно указывается хэштег{' '}
                  <span className="font-mono">#ВПраве</span>.
                </li>
                <li>Ссылка на публикацию направляется в Оргкомитет через личный кабинет команды.</li>
              </ul>
              <p className="mt-4 max-w-measure text-sm text-muted">
                Проверьте, что публикация открыта для просмотра: закрытая страница или удалённая публикация не позволит
                оценить ролик.
              </p>
              {requirement?.description ? (
                <p className="mt-3 max-w-measure text-sm text-muted">
                  Требование к комплекту первого этапа: {requirement.description}
                </p>
              ) : null}
            </Section>
          </div>

          <div id="dates">
            <Section title="Сроки" description="Все сроки указаны по московскому времени.">
              <dl className="grid gap-5 text-sm md:grid-cols-2">
                <div>
                  <dt className="mono-label text-muted">Подготовка и публикация во «ВКонтакте»</dt>
                  <dd className="mt-1">
                    {season?.stage1_from || season?.stage1_to
                      ? `${formatMoscowHuman(season?.stage1_from)} — ${formatMoscowHuman(season?.stage1_to)}`
                      : 'по календарному плану сезона'}
                  </dd>
                </div>
                <div>
                  <dt className="mono-label text-muted">Ссылка направляется в Оргкомитет</dt>
                  <dd className="mt-1">{publishingDue ? formatMoscowHuman(publishingDue) : 'срок определяется Оргкомитетом'}</dd>
                </div>
                <div>
                  <dt className="mono-label text-muted">Оценка видеороликов</dt>
                  <dd className="mt-1">после окончания приёма ссылок — до публикации протокола первого этапа</dd>
                </div>
                <div>
                  <dt className="mono-label text-muted">Голоса по итогам голосования</dt>
                  <dd className="mt-1">
                    {publishingDue
                      ? `учитываются на момент ${formatMoscowHuman(publishingDue)}`
                      : 'учитываются на момент окончания приёма ссылок'}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 max-w-measure text-sm">
                Учитываются не отметки «Мне нравится», а количество голосов по итогам голосования во «ВКонтакте».
                Голосование проводится для номинации <strong>«Приз зрительских симпатий»</strong>: голоса влияют только
                на неё. В финал проходит не команда, набравшая больше голосов, а команда с наибольшим количеством баллов
                по критериям оценки.
              </p>
              <p className="mt-3 max-w-measure text-sm text-muted">
                Оргкомитет не учитывает накрученные голоса и вправе отстранить команду от номинации.
              </p>
            </Section>
          </div>

          <div id="criteria">
            <Section
              title="Кто оценивает и по каким критериям"
              description={`Конкурсная комиссия первого этапа. Максимум — ${totalScore} баллов.`}
            >
              <p className="mb-4 max-w-measure text-sm">
                Итоговый балл этапа — среднее арифметическое сумм баллов членов Конкурсной комиссии с округлением до
                сотых. Голоса по итогам голосования во «ВКонтакте» на баллы не влияют: они учитываются только в
                номинации «Приз зрительских симпатий».
              </p>
              {criteria.length === 0 ? (
                <p className="text-sm text-muted">Критерии первого этапа загружаются.</p>
              ) : (
                <ul className="flex flex-col gap-3 text-sm">
                  {criteria.map((criterion) => {
                    const isVideo = videoCriterion?.id === criterion.id;
                    return (
                      <li
                        key={criterion.id}
                        className={isVideo ? 'border border-accent p-3' : 'border-b border-border pb-2'}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <span className="font-medium">{criterion.title}</span>
                          <span className="font-mono">{Number(criterion.max_score)} баллов</span>
                        </div>
                        {isVideo ? (
                          <p className="mt-1 text-muted">
                            Этот критерий оценивает видеоролик: содержательность, оригинальность подачи и соблюдение
                            Приложения № 7.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          <div id="appendix">
            <Section
              title="Приложение № 7"
              description="Требования к видеоролику и презентационным материалам — полный текст."
            >
              <Prose>
                <p className="text-sm">
                  Приложение № 7 — основной документ с требованиями к видеоролику. В нём указаны обязательные параметры
                  записи, содержание и оформление публикации; несоблюдение требований учитывается при оценке по критерию
                  о видеоролике.
                </p>
              </Prose>
              <p className="mt-4">
                {videoDocumentUrl ? (
                  <ActionLink to={videoDocumentUrl} external>
                    Открыть PDF
                  </ActionLink>
                ) : (
                  <span className="text-sm text-muted">
                    Файл Приложения № 7 готовится к публикации. Запросите его через раздел{' '}
                    <Link to="/contacts" className="text-accent underline underline-offset-2">
                      «Контакты»
                    </Link>
                    .
                  </span>
                )}
              </p>
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
