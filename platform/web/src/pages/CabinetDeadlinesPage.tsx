import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, formatMoscowDate, formatMoscowHuman } from '@shared/index';
import { Alert, Button } from '@shared/index';
import { ResponsiveTable } from '@/components/PageBlocks';
import { useSeo } from '@/lib/seo';
import {
  type CabinetData,
  CabinetContactForm,
  CabinetLayout,
  CabinetLoadError,
  CabinetLoading,
  CabinetSection,
  CabinetSessionLost,
  fetchCabinetData,
  useCountdown,
} from './CabinetActions';

// Раздел личного кабинета «Дедлайны» (ТЗ 06, п. 2.3): календарь этапов с пояснениями и
// статусами «пройдено / идёт / предстоит». Даты приходят из
// api.cabinetDeadlines() и показываются только по московскому времени.

type StageState = 'done' | 'active' | 'upcoming';

const STAGE_STATE_TITLES: Record<StageState, string> = {
  done: 'пройдено',
  active: 'идёт',
  upcoming: 'предстоит',
};

const STAGE_STATE_TONES: Record<StageState, string> = {
  done: 'border-success text-success',
  active: 'border-accent text-accent',
  upcoming: 'border-border-strong text-muted',
};

interface StageRow {
  id: string;
  title: string;
  period: string;
  state: StageState;
  meaning: string;
  action: string;
}

function stateOf(from: string | null, to: string | null, now: number): StageState {
  const fromAt = from ? new Date(from).getTime() : null;
  const toAt = to ? new Date(to).getTime() : null;
  if (toAt !== null && now > toAt) return 'done';
  if (fromAt !== null && now >= fromAt) return 'active';
  if (fromAt === null && toAt !== null) return now > toAt ? 'done' : 'active';
  return 'upcoming';
}

export function CabinetDeadlinesPage() {
  useSeo({
    title: 'Дедлайны конкурса',
    description:
      'Календарь этапов конкурса «Лидеры права – 2027» в личном кабинете команды: приём заявок, техническая проверка, первый этап и второй (финальный) этап со статусами и сроками по московскому времени.',
    path: '/cabinet/deadlines',
  });

  const [data, setData] = useState<CabinetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setSessionLost(false);
    try {
      setData(await fetchCabinetData());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSessionLost(true);
        setData(null);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить данные личного кабинета.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoading label="Загружаем сроки этапов…" />
      </main>
    );
  }

  if (sessionLost) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetSessionLost />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoadError message={error ?? 'Не удалось получить данные команды.'} onRetry={() => void load()} />
      </main>
    );
  }

  return <DeadlinesSection data={data} onReload={load} />;
}

function DeadlinesSection({ data, onReload }: { data: CabinetData; onReload: () => Promise<void> }) {
  const { deadlines, team } = data;
  const now = Date.now();
  const countdown = useCountdown(deadlines.milliseconds_left);

  const reachedFinal = ['finalist', 'final', 'winner'].includes(team.status);

  const stage1State: StageState = reachedFinal ? 'done' : stateOf(deadlines.stage1_from, deadlines.stage1_to, now);
  const finalState: StageState = team.status === 'winner' ? 'done' : reachedFinal ? 'active' : 'upcoming';

  const stages: StageRow[] = [
    {
      id: 'application',
      title: 'Приём заявок',
      period: deadlines.application_close_at
        ? `до ${formatMoscowHuman(deadlines.application_close_at)}`
        : 'даты уточняет Оргкомитет',
      state: stateOf(null, deadlines.application_close_at, now),
      meaning:
        'Команда подаёт заявку и загружает комплект отборочного этапа: текст законотворческой инициативы, пояснительную записку и другие материалы.',
      action: 'Материалы и состав команды меняются в разделах личного кабинета до окончания срока.',
    },
    {
      id: 'tech-check',
      title: 'Техническая проверка',
      period: deadlines.application_close_at ? `после ${formatMoscowDate(deadlines.application_close_at)}` : 'сразу после приёма заявок',
      state: stateOf(null, deadlines.application_close_at, now) === 'done' ? 'active' : 'upcoming',
      meaning:
        'Оргкомитет проверяет комплект: полноту, форматы, соответствие требованиям Приложений № 3–6 и согласия участников.',
      action: 'Если появятся замечания, они придут в раздел «Сводка» с отдельным сроком досдачи.',
    },
    {
      id: 'stage-1',
      title: 'Первый этап',
      period: deadlines.stage1_from
        ? `с ${formatMoscowDate(deadlines.stage1_from)} до ${formatMoscowHuman(deadlines.stage1_to)}`
        : deadlines.stage1_to
          ? `до ${formatMoscowHuman(deadlines.stage1_to)}`
          : 'даты уточняет Оргкомитет',
      state: stage1State,
      meaning:
        'Эксперты оценивают законотворческую инициативу и видеоролик по критериям конкурса; публикуется протокол первого этапа.',
      action: 'Проверьте комплект первого этапа: видеоролик прикрепляется ссылкой на публикацию во «ВКонтакте».',
    },
    {
      id: 'appeal',
      title: 'Срок апелляции по итогам этапа',
      period: `в течение ${deadlines.appeal_window_days} ${deadlines.appeal_window_days === 1 ? 'рабочего дня' : 'рабочих дней'} после публикации протокола`,
      state: stage1State === 'done' ? 'active' : 'upcoming',
      meaning:
        'Капитан команды вправе подать апелляцию по форме Приложения № 14: нарушение порядка этапа, необоснованный отказ, ошибка подсчёта баллов или неверное применение критериев (п. 12.1, 12.2 Положения).',
      action: 'Апелляция подаётся из раздела «Помощь» — форма обращения с темой «Апелляция по итогам этапа».',
    },
    {
      id: 'final',
      title: 'Второй (финальный) этап',
      period:
        deadlines.final_from && deadlines.final_to
          ? `с ${formatMoscowDate(deadlines.final_from)} до ${formatMoscowHuman(deadlines.final_to)}`
          : 'дату финала объявляет Оргкомитет',
      state: deadlines.final_from ? stateOf(deadlines.final_from, deadlines.final_to, now) : finalState,
      meaning:
        'Команды-финалисты подтверждают состав выступающих и представляют презентационные материалы не позднее чем за 7 календарных дней до финала (п. 9.2 Положения).',
      action: 'Подтверждение участия и состав выступающих — в разделе «Финал»; презентация — в конкурсных материалах.',
    },
  ];

  return (
    <CabinetLayout
      data={data}
      title="Дедлайны"
      lead="Календарь этапов конкурса и сроки сдачи материалов. Все даты и время указаны по московскому времени."
      onReload={onReload}
    >
      {!deadlines.is_application_open ? (
        <Alert tone="warning" title="Дедлайн пропущен: приём материалов отборочного этапа завершён">
          {deadlines.application_close_at
            ? `Срок истёк ${formatMoscowHuman(deadlines.application_close_at)}. Изменение материалов после срока не допускается (п. 7.5 Положения).`
            : 'Изменение материалов после срока не допускается (п. 7.5 Положения).'}{' '}
          Чтение комплекта и связь с Оргкомитетом доступны на{' '}
          <Link to="/cabinet/materials" className="text-accent underline underline-offset-2">
            странице конкурсных материалов
          </Link>
          .
        </Alert>
      ) : null}

      <CabinetSection
        title="Ближайший срок"
        description="Обратный отсчёт до окончания приёма материалов отборочного этапа (МСК)."
      >
        <div className="flex flex-col gap-3 border-t-2 border-accent pt-4">
          {deadlines.is_application_open ? (
            <>
              <p className="text-body font-medium">
                Приём конкурсных материалов отборочного этапа
              </p>
              <p role="status" className="font-mono text-mono-sm">
                {countdown.left > 0 ? countdown.text : 'срок истёк'}
              </p>
              <p className="text-sm text-muted">
                Крайний срок: {formatMoscowHuman(deadlines.application_close_at)}.
              </p>
            </>
          ) : (
            <>
              <p className="text-body font-medium">Приём конкурсных материалов завершён</p>
              <p className="font-mono text-mono-sm">срок истёк</p>
              <p className="text-sm text-muted">
                Срок истёк {formatMoscowHuman(deadlines.application_close_at)}. Дальнейшие сроки — по календарю этапов
                ниже.
              </p>
            </>
          )}
          <p className="text-sm">
            <Link to="/cabinet/materials" className="text-accent underline underline-offset-2">
              Перейти к конкурсным материалам
            </Link>
          </p>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Календарь этапов"
        description="Статусы: «пройдено», «идёт», «предстоит». Значения определяются по текущей дате и статусу заявки команды."
      >
        <ResponsiveTable
          caption="Календарь этапов конкурса и сроки"
          columns={['Этап', 'Срок', 'Статус', 'Что это значит', 'Что делать команде']}
          rows={stages}
          rowKey={(stage) => stage.id}
          renderCell={(stage, index) => {
            if (index === 0) return <span className="font-medium">{stage.title}</span>;
            if (index === 1) return <span className="text-muted">{stage.period}</span>;
            if (index === 2) {
              return (
                <span className={`mono-label inline-flex border px-2 py-1 ${STAGE_STATE_TONES[stage.state]}`}>
                  {STAGE_STATE_TITLES[stage.state]}
                </span>
              );
            }
            if (index === 3) return <span>{stage.meaning}</span>;
            return <span className="text-muted">{stage.action}</span>;
          }}
        />
      </CabinetSection>

      <CabinetSection
        title="Сроки устранения замечаний"
        description="Оргкомитет даёт не более двух рабочих дней на исправление (п. 7.5 Положения)."
      >
        {deadlines.fix_deadlines.length === 0 ? (
          <p className="text-sm text-muted">
            Сроков досдачи нет: замечаний по материалам команды не зафиксировано.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {deadlines.fix_deadlines.map((item) => (
              <li key={item.material_id} className="border border-border px-4 py-3">
                <p className="font-medium">{item.type_title}</p>
                <p className={item.is_open ? 'text-fg' : 'text-danger'}>
                  {item.is_open
                    ? `Успеть до ${formatMoscowHuman(item.fix_deadline)}`
                    : `Срок досдачи истёк ${formatMoscowHuman(item.fix_deadline)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm">
          <Link to="/cabinet/materials" className="text-accent underline underline-offset-2">
            Открыть конкурсные материалы
          </Link>
        </p>
      </CabinetSection>

      <CabinetSection
        title="Источник дат"
        description="Даты не хранятся в интерфейсе: они приходят из данных конкурса."
      >
        <p className="text-sm text-muted">
          Часовой пояс расчётов: {deadlines.timezone}. Время работы Оргкомитета — по московскому времени; сроки,
          указанные в Положении, тоже считаются по МСК.
        </p>
        <p className="mt-3 text-sm text-muted">
          Если дата не совпадает с Положением, напишите в Оргкомитет — решение принимает Оргкомитет, а не интерфейс.
        </p>
      </CabinetSection>

      <CabinetSection
        title="Связаться с организаторами"
        description="Вопросы по срокам, досдаче и апелляции."
      >
        <CabinetContactForm
          showTopic
          defaultTopic={deadlines.is_application_open ? 'general' : 'deadline'}
          compactNote="Если вопрос о пропущенном сроке, выберите тему «Связь по дедлайну»: обращение попадёт в очередь на досдачу."
        />
      </CabinetSection>

      <div>
        <Button variant="secondary" onClick={() => void onReload()}>
          Обновить сроки
        </Button>
      </div>
    </CabinetLayout>
  );
}
