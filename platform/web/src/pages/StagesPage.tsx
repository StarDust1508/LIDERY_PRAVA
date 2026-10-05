import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type PublicCriterion,
  type Season,
  api,
  evaluationStageTitle,
  formatMoscowHuman,
} from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Этапы, календарь и критерии (ТЗ 08, п. 2.1 и раздел 10 Положения).
// Календарь берётся из активного сезона, критерии — из справочника критериев:
// правки Оргкомитета в админке сразу видны на сайте.

export function StagesPage() {
  const [season, setSeason] = useState<Season | null>(null);
  const [criteria, setCriteria] = useState<PublicCriterion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useSeo({
    title: 'Этапы, календарь и критерии',
    description:
      'Три этапа конкурса «Лидеры права – 2027»: отборочный, первый (видеопрезентация) и финальный в Москве. Календарь по московскому времени и критерии оценки по этапам.',
    path: '/stages',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Этапы', path: '/stages' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [seasonData, criteriaData] = await Promise.all([api.season(), api.criteria()]);
        if (!active) return;
        setSeason(seasonData.season);
        setCriteria(criteriaData);
      } catch {
        if (active) setError('Не удалось загрузить календарь и критерии.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const byStage = useMemo(() => {
    const map = new Map<string, PublicCriterion[]>();
    for (const criterion of criteria) {
      const list = map.get(criterion.stage) ?? [];
      list.push(criterion);
      map.set(criterion.stage, list);
    }
    return [...map.entries()];
  }, [criteria]);

  const calendar: Array<[string, string]> = season
    ? [
        ['Приём заявок и материалов', `${formatMoscowHuman(season.application_open_at)} — ${formatMoscowHuman(season.application_close_at)}`],
        ['Техническая проверка материалов', `${formatMoscowHuman(season.tech_check_from)} — ${formatMoscowHuman(season.tech_check_to)}`],
        ['Первый этап: видеопрезентации', `${formatMoscowHuman(season.stage1_from)} — ${formatMoscowHuman(season.stage1_to)}`],
        ['Второй (финальный) этап', `${formatMoscowHuman(season.final_from)} — ${formatMoscowHuman(season.final_to)}`],
        ['Срок подачи апелляций', `${season.appeal_window_days} рабочих дня с момента опубликования протокола этапа`],
      ]
    : [];

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Порядок и сроки</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Этапы конкурса</h1>
        <p className="mt-3 max-w-measure text-muted">
          Конкурс проводится в три этапа. Все сроки определяются по московскому времени; окончание срока — 23:59
          последнего дня (п. 6.2 Положения).
        </p>
      </header>

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <SectionCard title="Этапы" description="Формат этапов установлен разделом 6 Положения.">
        <ol className="flex flex-col gap-4 text-sm">
          <li>
            <strong>Отборочный этап (заочный).</strong> Экспертиза законотворческих инициатив онлайн-комиссией. Участники
            прикладывают текст законопроекта и пояснительную записку.
          </li>
          <li>
            <strong>Первый этап (дистанционный).</strong> Видеопрезентация инициативы и команды: публикация во
            «ВКонтакте» с хэштегом <span className="font-mono">#Лидеры_права_2027</span>.
          </li>
          <li>
            <strong>Второй (финальный) этап (очный, Москва).</strong> Групповые выступления, дебаты и Гранд-финал перед
            Жюри. Решения финального этапа апелляции не подлежат (п. 9.6).
          </li>
        </ol>
      </SectionCard>

      <SectionCard title="Календарный план" description={`Сезон: ${season?.title ?? '—'}`}>
        {calendar.length === 0 ? (
          <p className="text-sm text-muted">Календарь загружается…</p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only-text">Календарный план конкурса</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4">Мероприятие</th>
                    <th scope="col" className="py-2">Срок</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.map(([title, value]) => (
                    <tr key={title} className="border-b border-border">
                      <td className="py-2 pr-4">{title}</td>
                      <td className="py-2">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* На мобильных таблица превращается в карточки (ТЗ 08, п. 3.6). */}
            <ul className="flex flex-col gap-3 md:hidden">
              {calendar.map(([title, value]) => (
                <li key={`card-${title}`} className="border border-border p-4 text-sm">
                  <p className="mono-label text-muted">{title}</p>
                  <p className="mt-1">{value}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-sm text-muted">
          Даты могут быть изменены решением Оргкомитета с публикацией информации на официальных ресурсах не позднее чем
          за 5 календарных дней.
        </p>
      </SectionCard>

      <SectionCard title="Критерии оценки" description="Максимум баллов указан для одного члена комиссии (раздел 10 Положения).">
        {byStage.length === 0 ? (
          <p className="text-sm text-muted">Критерии загружаются…</p>
        ) : (
          <div className="flex flex-col gap-6">
            {byStage.map(([stage, items]) => (
              <div key={stage}>
                <h3 className="text-h3 font-semibold">{evaluationStageTitle(stage)}</h3>
                <p className="mt-1 text-sm text-muted">
                  Итого:{' '}
                  {items.reduce((sum, item) => sum + Number(item.max_score), 0)} баллов
                </p>
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap justify-between gap-3 border-b border-border pb-2">
                      <span>
                        {item.title}
                        {item.description ? <span className="block text-muted">{item.description}</span> : null}
                      </span>
                      <span className="font-mono">{Number(item.max_score)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-sm">
          <Link to="/participants/materials" className="text-accent underline underline-offset-2">
            Требования к конкурсным материалам
          </Link>
        </p>
      </SectionCard>
    </main>
  );
}
