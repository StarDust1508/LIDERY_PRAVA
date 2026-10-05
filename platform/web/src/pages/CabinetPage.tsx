import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type Material,
  StatusBadge,
  formatMoscowHuman,
  materialTypeTitle,
  pluralize,
  teamStatusTitle,
} from '@shared/index';
import { Alert, Button } from '@shared/index';
import { ResponsiveTable } from '@/components/PageBlocks';
import { useSeo } from '@/lib/seo';
import {
  type CabinetData,
  type KitItem,
  CabinetContactForm,
  CabinetLayout,
  CabinetLoadError,
  CabinetLoading,
  CabinetSection,
  CabinetSessionLost,
  KIT_STATE_TITLES,
  KIT_STATE_TONES,
  applicationStatusText,
  buildKit,
  fetchCabinetData,
  fetchCabinetDataOnly,
  fixDeadlineFor,
  kitProgress,
  teamHasMinor,
  useCountdown,
} from './CabinetActions';

// Личный кабинет команды: каркас с постоянной навигацией по разделам и экран
// «Сводка» (ТЗ 06, п. 2). Данные команды отдаются только по её сессии —
// проверка на сервере, интерфейс объясняет состояние, а не молчит.

/** Ближайшее незакрытое действие: что сделать и до какого времени. */
interface NextStep {
  title: string;
  deadline: string | null;
  note: string;
}

function nearestStep(data: CabinetData, kit: KitItem[]): NextStep {
  const needsFix = kit.filter((item) => item.required && item.state === 'needs_fix');
  if (needsFix.length > 0) {
    const first = needsFix[0];
    const deadline = first ? fixDeadlineFor(data, first.current as Material) : null;
    return {
      title: `Устранить замечания: ${needsFix.map((item) => item.title).join('; ')}`,
      deadline: deadline ?? data.deadlines.application_close_at,
      note: 'Замечания Оргкомитета — в блоке ниже.',
    };
  }

  if (!data.deadlines.is_application_open) {
    return {
      title: 'Приём материалов отборочного этапа завершён',
      deadline: data.deadlines.application_close_at,
      note: 'Изменение материалов после срока не допускается (п. 7.5 Положения).',
    };
  }

  const missing = kit.filter((item) => item.required && (item.state === 'missing' || item.state === 'in_review'));
  if (missing.length > 0) {
    return {
      title: `Сдать обязательные материалы: ${missing.map((item) => item.title).join('; ')}`,
      deadline: data.deadlines.application_close_at,
      note: 'Файлы и ссылки загружаются в разделе «Конкурсные материалы».',
    };
  }

  if (data.team.submitted_at === null) {
    return {
      title: 'Отправить заявку из мастера подачи',
      deadline: data.deadlines.application_close_at,
      note: 'До отправки заявка остаётся черновиком и в техническую проверку не попадает.',
    };
  }

  return {
    title: 'Все обязательные материалы сданы',
    deadline: data.deadlines.application_close_at,
    note: 'Следите за замечаниями и итогами этапа: они появляются на этой странице.',
  };
}

export function CabinetPage() {
  useSeo({
    title: 'Личный кабинет команды',
    description:
      'Личный кабинет команды конкурса «Лидеры права – 2027»: статус заявки, состав команды, готовность комплекта конкурсных материалов, ближайший дедлайн и замечания Оргкомитета.',
    path: '/cabinet',
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

  const reload = useCallback(async () => {
    const team = data?.team;
    if (!team) {
      await load();
      return;
    }
    try {
      const fresh = await fetchCabinetDataOnly();
      setData({ team, ...fresh });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setSessionLost(true);
    }
  }, [data?.team, load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Возврат к вкладке обновляет сроки: обратный отсчёт и статус не «замерзают».
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void reload();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <CabinetLoading />
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

  return <CabinetSummary data={data} onReload={reload} />;
}

function CabinetSummary({ data, onReload }: { data: CabinetData; onReload: () => Promise<void> }) {
  const { team, deadlines } = data;
  const status = applicationStatusText(data);
  const kit = buildKit(data, teamHasMinor(team));
  const progress = kitProgress(kit);
  const next = nearestStep(data, kit);
  const countdown = useCountdown(deadlines.milliseconds_left);

  const captain = team.participants.find((participant) => participant.role === 'captain');
  const remarks = kit.filter(
    (item): item is KitItem & { current: Material } =>
      item.current !== null && (item.current.status === 'needs_fix' || item.current.status === 'rejected')
  );

  return (
    <CabinetLayout
      data={data}
      title="Сводка"
      lead="Статус заявки, готовность комплекта конкурсных материалов, ближайший срок и замечания Оргкомитета."
      onReload={onReload}
    >
      {data.team.submitted_at === null ? (
        <Alert tone="info" title="Заявка ещё не отправлена">
          Заполните оставшиеся шаги мастера и отправьте заявку: до отправки она остаётся черновиком и в
          техническую проверку не попадает.{' '}
          <Link to="/apply" className="text-accent underline underline-offset-2">
            Продолжить заполнение
          </Link>
          .
        </Alert>
      ) : null}

      {!deadlines.is_application_open ? (
        <Alert tone="warning" title="Дедлайн пропущен: приём материалов отборочного этапа завершён">
          {deadlines.application_close_at
            ? `Срок истёк ${formatMoscowHuman(deadlines.application_close_at)}. Изменение материалов после срока не допускается (п. 7.5 Положения). Чтение комплекта сохранено.`
            : 'Изменение материалов после срока не допускается (п. 7.5 Положения). Чтение комплекта сохранено.'}{' '}
          Если нужна досдача по замечанию, напишите в Оргкомитет — форма ниже и в разделе «Помощь».
        </Alert>
      ) : null}

      <CabinetSection title="Статус заявки" description="Одна понятная формулировка и что будет дальше.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={team.status} title={teamStatusTitle(team.status)} />
            <p className="text-body font-medium">{status.title}</p>
          </div>
          <p className="max-w-measure text-sm text-muted">{status.next}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 border-b border-border pb-2">
              <dt className="text-muted">Номер заявки</dt>
              <dd className="font-mono">{team.public_number ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-border pb-2">
              <dt className="text-muted">Направление конкурса</dt>
              <dd>{team.direction?.title ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-border pb-2">
              <dt className="text-muted">Заявка подана</dt>
              <dd>{team.submitted_at ? formatMoscowHuman(team.submitted_at) : 'ещё не подана'}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-border pb-2">
              <dt className="text-muted">Приём заявок до</dt>
              <dd>{formatMoscowHuman(team.application_close_at)}</dd>
            </div>
          </dl>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Ближайший дедлайн"
        description="Обратный отсчёт идёт по московскому времени."
      >
        <div className="flex flex-col gap-4 border-t-2 border-accent pt-4">
          <p className="text-body font-medium">{next.title}</p>
          <p className="font-mono text-mono-sm">
            {countdown.left > 0 ? countdown.text : 'срок истёк'}
            {next.deadline ? ` · до ${formatMoscowHuman(next.deadline)}` : ''}
          </p>
          <p className="text-sm text-muted">{next.note}</p>
          <p className="text-sm text-muted">
            Все сроки этапов — в разделе{' '}
            <Link to="/cabinet/deadlines" className="text-accent underline underline-offset-2">
              «Дедлайны»
            </Link>
            .
          </p>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Готовность комплекта"
        description="Обязательные конкурсные материалы отборочного этапа и их состояние."
      >
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm text-muted">
            Сдано {progress.done} из {progress.total}
            {progress.needsFix > 0
              ? `; требуют исправления: ${pluralize(progress.needsFix, ['материал', 'материала', 'материалов'])}`
              : ''}
            .
          </p>
          <div
            role="img"
            aria-label={`Готовность комплекта: сдано ${progress.done} из ${progress.total}`}
            className="h-2 w-full max-w-measure border border-border bg-surface"
          >
            <div
              className="h-full bg-accent-bright"
              style={{ width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }}
            />
          </div>

          <ResponsiveTable
            caption="Готовность комплекта конкурсных материалов"
            columns={['Материал', 'Состояние', 'Что загружено', 'Срок']}
            rows={kit}
            rowKey={(item) => item.requirement?.type ?? `extra-${item.title}`}
            renderCell={(item, index) => {
              if (index === 0) {
                return (
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-sm text-muted">{item.required ? 'обязательный' : 'по желанию'}</span>
                  </span>
                );
              }
              if (index === 1) {
                return (
                  <span className={`mono-label inline-flex border px-2 py-1 ${KIT_STATE_TONES[item.state]}`}>
                    {KIT_STATE_TITLES[item.state]}
                  </span>
                );
              }
              if (index === 2) {
                if (!item.current) return <span className="text-muted">файл не загружен</span>;
                return (
                  <span className="flex flex-col gap-1">
                    <span className="break-all">
                      {item.current.file_name ?? item.current.external_url ?? '—'}
                    </span>
                    {item.versions.length > 1 ? (
                      <span className="text-sm text-muted">
                        загружено {pluralize(item.versions.length, ['версия', 'версии', 'версий'])}
                      </span>
                    ) : null}
                  </span>
                );
              }
              return <span className="text-muted">{item.deadline ? formatMoscowHuman(item.deadline) : '—'}</span>;
            }}
          />

          <p className="text-sm">
            <Link to="/cabinet/materials" className="text-accent underline underline-offset-2">
              Перейти к конкурсным материалам
            </Link>
          </p>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Замечания Оргкомитета"
        description="Что исправить, в какой срок и по какому материалу."
      >
        {remarks.length === 0 ? (
          <p className="text-sm text-muted">
            Замечаний нет. Если Оргкомитет оставит замечание, оно появится здесь с указанием срока.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {remarks.map((item) => {
              const deadline = item.current.fix_deadline ?? fixDeadlineFor(data, item.current);
              return (
                <li key={item.current.id} className="border border-danger bg-danger-tint px-4 py-3 text-sm">
                  <p className="font-medium">
                    {item.current.type_title || materialTypeTitle(item.current.type)}
                    <span className="text-muted"> · версия {item.current.version}</span>
                  </p>
                  <p className="mt-1">{item.current.reviewer_comment ?? 'Замечание без текста — уточните в Оргкомитете.'}</p>
                  <p className="mt-1 text-muted">
                    Срок устранения: {deadline ? formatMoscowHuman(deadline) : 'срок не указан'}
                    {item.current.reviewed_at ? ` · замечание оставлено ${formatMoscowHuman(item.current.reviewed_at)}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-sm text-muted">
          Замечания оставляет Оргкомитет по итогам технической проверки; срок досдачи — не более двух рабочих дней
          (п. 7.5 Положения).
        </p>
      </CabinetSection>

      <CabinetSection
        title="Команда"
        description="Название, направление конкурса, капитан команды, участники и наставники."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {pluralize(team.participants.length, ['участник', 'участника', 'участников'])} и{' '}
            {pluralize(team.mentors.length, ['наставник', 'наставника', 'наставников'])}
            {captain ? `; капитан команды — ${captain.full_name}` : ''}.
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {team.participants.map((participant) => (
              <li key={participant.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2">
                <span>{participant.full_name}</span>
                <span className="text-muted">
                  {participant.role === 'captain' ? 'капитан команды' : 'участник'}
                  {participant.is_minor ? ' · младше 18 лет' : ''}
                </span>
              </li>
            ))}
            {team.mentors.map((mentor) => (
              <li key={`mentor-${mentor.id}`} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2">
                <span>{mentor.full_name}</span>
                <span className="text-muted">наставник</span>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <Link to="/cabinet/team" className="text-accent underline underline-offset-2">
              Перейти к составу команды
            </Link>
          </p>
        </div>
      </CabinetSection>

      <CabinetSection
        title="Связаться с организаторами"
        description="Обращение доступно в любой момент, в том числе после окончания приёма материалов."
      >
        <CabinetContactForm compactNote="Оргкомитет ответит на адрес электронной почты капитана команды. Контакты и частые вопросы — в разделе «Помощь»." />
        <p className="mt-4 text-sm text-muted">
          Нужны телефоны, ссылки на сообщество и ответы на частые вопросы?{' '}
          <Link to="/cabinet/help" className="text-accent underline underline-offset-2">
            Раздел «Помощь»
          </Link>
          .
        </p>
      </CabinetSection>

      {data.deadlines.fix_deadlines.length > 0 ? (
        <CabinetSection
          title="Сроки устранения замечаний"
          description="Отдельный срок по каждому материалу, который вернули на исправление."
        >
          <ul className="flex flex-col gap-2 text-sm">
            {data.deadlines.fix_deadlines.map((item) => (
              <li key={item.material_id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2">
                <span>{item.type_title}</span>
                <span className={item.is_open ? 'text-fg' : 'text-danger'}>
                  {item.is_open
                    ? `успеть до ${formatMoscowHuman(item.fix_deadline)}`
                    : `срок досдачи истёк ${formatMoscowHuman(item.fix_deadline)}`}
                </span>
              </li>
            ))}
          </ul>
        </CabinetSection>
      ) : null}

      <p className="text-sm text-muted">
        Прогресс комплекта: сдано {progress.done} из {progress.total}.
        {team.status === 'draft' ? ' После отправки заявки состав и материалы проверяет Оргкомитет.' : ''}
      </p>

      <div>
        <Button variant="secondary" onClick={() => void onReload()}>
          Обновить данные
        </Button>
      </div>
    </CabinetLayout>
  );
}
