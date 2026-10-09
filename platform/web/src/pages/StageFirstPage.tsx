import { useEffect, useState } from 'react';
import {
  type MaterialRequirement,
  type PublicCriterion,
  type PublicDocument,
  api,
  formatMoscowDate,
  formatMoscowHuman,
  pluralize,
} from '@shared/index';
import { Alert } from '@shared/index';
import { ActionLink, PageHeader, Prose, ResponsiveTable, Section } from '@/components/PageBlocks';
import { breadcrumbs, useSeo } from '@/lib/seo';
import { useSeason } from '@/lib/season';
import { formatPeriod, useOrganizerText } from './StagesPage';

// Первый этап (ТЗ 02, п. 5.2 и 6.2; ТЗ 08, п. 2.1).
//
// Срок публикации видеоролика берётся из требования к материалу
// material_requirements('stage1'), критерии — из справочника, ссылка на
// Приложение № 7 — из опубликованных документов редакции 04.10.2026.

const BREADCRUMBS = breadcrumbs([
  { name: 'Главная', path: '/' },
  { name: 'Этапы', path: '/stages' },
  { name: 'Первый этап', path: '/stages/first' },
]);

/** Номер приложения из названия вида «Приложение № 7. Требования…». */
function appendixUrl(documents: PublicDocument[], number: string): string | null {
  const document = documents.find((item) => new RegExp(`Приложение\\s*№\\s*${number}\\b`).test(item.title));
  return document?.external_url ?? document?.file_url ?? null;
}

export function StageFirstPage() {
  const { data: seasonData } = useSeason();
  const season = seasonData?.season ?? null;

  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [requirements, setRequirements] = useState<MaterialRequirement[]>([]);
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const organizerText = useOrganizerText('stage-first');

  useSeo({
    title: 'Первый этап',
    description:
      'Первый этап конкурса «Лидеры права – 2027»: подготовка и публикация видеороликов во «ВКонтакте», оценка видеороликов и материалов, «Приз зрительских симпатий» и критерии на 80 баллов.',
    path: '/stages/first',
    jsonLd: BREADCRUMBS,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [criteriaData, requirementsData, documentsData] = await Promise.all([
          api.criteria('stage1'),
          api.materialRequirements('stage1'),
          api.documents(),
        ]);
        if (!active) return;
        setCriteria(criteriaData);
        setRequirements(requirementsData.requirements);
        setDocuments(documentsData);
      } catch {
        if (active) setError('Не удалось загрузить критерии, требования к видеоролику и документы.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const videoRequirement = requirements.find((item) => item.type === 'video_link') ?? null;
  const videoPdf = appendixUrl(documents, '7');
  const totalScore = criteria.reduce((sum, criterion) => sum + Number(criterion.max_score), 0);

  const appealWindow = season
    ? `${pluralize(season.appeal_window_days, ['рабочий день', 'рабочих дня', 'рабочих дней'])} с момента опубликования протокола этапа`
    : 'срок, установленный Положением о конкурсе';

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Этапы"
        title="Первый этап"
        lead={
          <>
            Этап проходит дистанционно. Команды публикуют видеопрезентацию инициативы и команды во «ВКонтакте», затем
            Конкурсная комиссия оценивает видеоролик и конкурсные материалы.
          </>
        }
        actions={
          <>
            <ActionLink to="/participants/video-requirements" variant="secondary">
              Требования к видеоролику
            </ActionLink>
            <ActionLink to="/stages/criteria" variant="secondary">
              Критерии оценки
            </ActionLink>
          </>
        }
      />

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <Section title="Сроки и порядок" description="Все даты — по московскому времени (МСК, UTC+3).">
        {season ? (
          <ul className="flex flex-col gap-5 text-sm">
            <li>
              <p className="mono-label text-muted">Подготовка и публикация видеороликов во «ВКонтакте»</p>
              <p className="mt-1">{formatPeriod(season.stage1_from, season.stage1_to)}</p>
              <p className="mt-1 text-muted">
                {videoRequirement?.due_at
                  ? `Ссылка на публикацию направляется в Оргкомитет не позднее ${formatMoscowHuman(videoRequirement.due_at)}.`
                  : 'Точный срок направления ссылки на публикацию указан в календаре конкурса.'}
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Оценка видеороликов и материалов первого этапа</p>
              <p className="mt-1 text-muted">
                Проводится после публикации видеороликов. Каждую инициативу оценивает Конкурсная
                комиссии независимо друг от друга.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Подсчёт «Приза зрительских симпатий»</p>
              <p className="mt-1 text-muted">
                Учитываются отметки «Мне нравится» у публикаций с хэштегом <span className="font-mono">#ВПраве</span>.
                Оргкомитет не учитывает накрученные реакции.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Публикация протокола итогов первого этапа</p>
              <p className="mt-1 text-muted">
                Список команд-финалистов публикуется не позднее {formatMoscowDate(season.stage1_to)}; баллы команды
                видны в личном кабинете.
              </p>
            </li>
            <li>
              <p className="mono-label text-muted">Подача апелляций</p>
              <p className="mt-1 text-muted">{appealWindow}.</p>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Сроки загружаются. Действующие даты собраны на странице «Календарь конкурса».
          </p>
        )}
        <div className="mt-5">
          <ActionLink to="/stages/calendar" variant="secondary">
            Календарь конкурса
          </ActionLink>
        </div>
      </Section>

      <Section
        title="Видеоролик во «ВКонтакте»"
        description="Пункты 8.2–8.4 Положения и Приложение № 7."
      >
        <Prose>
          <p>
            Видеоролик публикуется на стене личной страницы или сообщества команды с хэштегом{' '}
            <span className="font-mono">#Лидеры_права_2027</span>, названием команды и законопроекта. Для участия в
            номинации «Приз зрительских симпатий» дополнительно указывается хэштег{' '}
            <span className="font-mono">#ВПраве</span>.
          </p>
          {videoRequirement?.description ? <p className="text-muted">{videoRequirement.description}</p> : null}
          <p className="text-muted">
            Продолжительность видеоролика — до 5 минут. Ссылка на публикацию направляется в Оргкомитет через личный
            кабинет; загружать сам файл не нужно.
          </p>
        </Prose>
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionLink to="/participants/video-requirements" variant="secondary">
            Требования к видеоролику
          </ActionLink>
          {videoPdf ? (
            <ActionLink to={videoPdf} variant="secondary" external>
              Приложение № 7 (PDF)
            </ActionLink>
          ) : null}
        </div>
      </Section>

      <Section title="Приз зрительских симпатий" description="Зрительская номинация раздела 11 Положения.">
        <Prose>
          <p>
            Номинацию получает команда, чья публикация с хэштегом <span className="font-mono">#ВПраве</span> набрала
            наибольшее число отметок «Мне нравится». Оргкомитет вправе отстранить команду от номинации, если обнаружены
            накрученные реакции.
          </p>
          <p className="text-muted">
            Участие в номинации не влияет на баллы первого этапа: зрительские отметки учитываются отдельно от оценки
            Конкурсной комиссии.
          </p>
        </Prose>
      </Section>

      <Section
        title="Критерии первого этапа"
        description="Пункт 10.3 Положения. Каждый критерий оценивается по шкале от 0 до 10."
      >
        {criteria.length === 0 ? (
          <p className="text-sm text-muted">Критерии загружаются…</p>
        ) : (
          <>
            <ResponsiveTable
              caption="Критерии первого этапа и максимум баллов"
              columns={['Критерий', 'Максимум баллов']}
              rows={criteria}
              rowKey={(row) => row.id}
              renderCell={(row, index) =>
                index === 0 ? (
                  <>
                    <span>{row.title}</span>
                    {row.description ? <span className="mt-1 block text-muted">{row.description}</span> : null}
                  </>
                ) : (
                  <span className="font-mono">{Number(row.max_score)}</span>
                )
              }
            />
            <p className="mt-4 text-sm">
              Итого: <strong>{pluralize(totalScore, ['балл', 'балла', 'баллов'])}</strong> от одного члена Конкурсной
              комиссии.
            </p>
          </>
        )}
      </Section>

      <Section title="Что дальше" description="От первого этапа ко второму (финальному).">
        <Prose>
          <p>
            По итогам первого этапа определяются команды-финалисты. При равенстве баллов преимущество получает команда с
            более высоким баллом отборочного этапа (пункт 8.6 Положения).
          </p>
          <p className="text-muted">
            Финалисты подтверждают участие и представляют презентационные материалы не позднее чем за семь календарных
            дней до начала второго (финального) этапа.
          </p>
        </Prose>
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionLink to="/stages/final" variant="secondary">
            Второй (финальный) этап
          </ActionLink>
          <ActionLink to="/stages/appeals" variant="secondary">
            Апелляции
          </ActionLink>
        </div>
      </Section>

      {organizerText ? (
        <Section title="От Оргкомитета" description="Дополнительные сведения, опубликованные Оргкомитетом.">
          <Prose>
            <p className="whitespace-pre-line">{organizerText}</p>
          </Prose>
        </Section>
      ) : null}
    </main>
  );
}
