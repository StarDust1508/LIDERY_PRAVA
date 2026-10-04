import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  type DeadlinesResponse,
  type Material,
  type TeamResponse,
  api,
  formatMoscowHuman,
  formatTimeLeft,
  MATERIAL_STATUS_TITLES,
  pluralize,
  teamStatusTitle,
} from '@shared/index';
import { Alert, Button, PageHeader, SectionCard, StatusBadge } from '@/ui/primitives';
import { saveBlob } from '@/lib/download';

// Сводка личного кабинета: номер заявки, статус, состав, материалы и сроки.
// Данные команды отдаются только по её сессии (проверка на сервере).

export function CabinetPage() {
  const navigate = useNavigate();
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlinesResponse | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formBusy, setFormBusy] = useState<'docx' | 'pdf' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  /** Скачивание заполненного бланка заявки (Приложение № 1). */
  async function downloadApplicationForm(format: 'docx' | 'pdf') {
    if (!team?.public_number) return;
    setFormError(null);
    setFormBusy(format);
    try {
      const blob = await api.cabinetApplicationForm(format);
      saveBlob(blob, `zayavka-${team.public_number}.${format}`);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Не удалось сформировать бланк заявки.');
    } finally {
      setFormBusy(null);
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const session = await api.cabinetSession();
      if (!session.authenticated) {
        navigate('/cabinet/access', { replace: true });
        return;
      }
      const [teamData, deadlinesData, materialsData] = await Promise.all([
        api.cabinetTeam(),
        api.cabinetDeadlines(),
        api.cabinetMaterials(),
      ]);
      setTeam(teamData);
      setDeadlines(deadlinesData);
      setMaterials(materialsData);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        navigate('/cabinet/access', { replace: true });
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить данные кабинета.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await api.cabinetLogout().catch(() => undefined);
    navigate('/cabinet/access', { replace: true });
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <p role="status">Загружаем данные команды…</p>
      </main>
    );
  }

  if (!team) {
    return (
      <main className="mx-auto max-w-container px-6 py-12">
        <Alert tone="danger" title="Кабинет недоступен">
          {error ?? 'Не удалось получить данные команды.'}
        </Alert>
      </main>
    );
  }

  const captain = team.participants.find((participant) => participant.role === 'captain');
  const submitted = team.submitted_at !== null;
  const deadlinePassed = deadlines ? !deadlines.is_application_open : false;

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow={team.public_number ? `Заявка ${team.public_number}` : 'Личный кабинет'}
        title={team.name}
        lead={team.direction ? `Направление: ${team.direction.title}` : undefined}
        aside={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={team.status} title={teamStatusTitle(team.status)} />
            <Button variant="secondary" onClick={() => void logout()}>
              Выйти
            </Button>
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {deadlinePassed ? (
        <Alert tone="warning" title="Срок приёма заявок истёк">
          Изменять состав и материалы нельзя. Напишите в Оргкомитет: Тажибов Арслан Азизович, 8 (966) 789-76-05,{' '}
          <a className="underline underline-offset-2" href="https://vk.ru/id274466891">
            vk.ru/id274466891
          </a>
          , ssla_av@mail.ru, сообщество{' '}
          <a className="underline underline-offset-2" href="https://vk.com/lideri.prava2026">
            vk.com/lideri.prava2026
          </a>
          .
        </Alert>
      ) : null}

      {!submitted ? (
        <Alert tone="info" title="Заявка ещё не отправлена">
          Заполните оставшиеся шаги мастера и отправьте заявку: до отправки она остаётся черновиком и в техническую проверку
          не попадает.{' '}
          <Link to="/apply" className="text-accent underline underline-offset-2">
            Продолжить заполнение
          </Link>
          .
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Заявка">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Номер заявки</dt>
              <dd className="font-mono">{team.public_number ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Статус заявки</dt>
              <dd>{teamStatusTitle(team.status)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Отправлена</dt>
              <dd>{team.submitted_at ? formatMoscowHuman(team.submitted_at) : 'нет'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Срок приёма заявок</dt>
              <dd>{formatMoscowHuman(team.application_close_at)}</dd>
            </div>
            {deadlines && !deadlinePassed ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">До окончания приёма</dt>
                <dd>{formatTimeLeft(deadlines.milliseconds_left)}</dd>
              </div>
            ) : null}
          </dl>
        </SectionCard>

        <SectionCard title="Состав команды">
          <p className="text-sm text-muted">
            {pluralize(team.participants.length, ['участник', 'участника', 'участников'])} и{' '}
            {pluralize(team.mentors.length, ['наставник', 'наставника', 'наставников'])}
            {captain ? `; капитан команды — ${captain.full_name}` : ''}.
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm">
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
        </SectionCard>
      </div>

      <SectionCard
        title="Конкурсные материалы"
        description="Комплект отборочного этапа: текст законопроекта и пояснительная записка, а для участников младше 18 лет — скан согласия законного представителя."
      >
        {materials.length === 0 ? (
          <p className="text-sm text-muted">Материалы ещё не загружены.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only-text">Загруженные конкурсные материалы</caption>
              <thead>
                <tr className="border-b border-border-strong text-left">
                  <th scope="col" className="py-2 pr-4">Материал</th>
                  <th scope="col" className="py-2 pr-4">Файл или ссылка</th>
                  <th scope="col" className="py-2 pr-4">Статус</th>
                  <th scope="col" className="py-2">Замечание</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.id} className="border-b border-border">
                    <td className="py-2 pr-4">{material.type_title}</td>
                    <td className="py-2 pr-4">{material.file_name ?? material.external_url ?? '—'}</td>
                    <td className="py-2 pr-4">{MATERIAL_STATUS_TITLES[material.status] ?? material.status}</td>
                    <td className="py-2">{material.reviewer_comment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-sm text-muted">
          Загрузка и замена материалов — в мастере подачи.{' '}
          <Link to="/apply" className="text-accent underline underline-offset-2">
            Перейти к материалам
          </Link>
          .
        </p>
      </SectionCard>

      <SectionCard
        title="Бланк заявки по Приложению № 1"
        description="Заявка формируется системой: бланк заполнен данными команды, участников, наставников и инициативы. Скачивание и подписание — по желанию команды, загружать бланк не нужно."
      >
        {formError ? (
          <div className="mb-4">
            <Alert tone="warning">{formError}</Alert>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={formBusy === 'docx'} onClick={() => void downloadApplicationForm('docx')} disabled={formBusy !== null}>
            Скачать в DOCX
          </Button>
          <Button
            variant="secondary"
            loading={formBusy === 'pdf'}
            onClick={() => void downloadApplicationForm('pdf')}
            disabled={formBusy !== null}
          >
            Скачать в PDF
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted">
          PDF формируется сервером; если на сервере нет LibreOffice, доступен только DOCX — об этом появится сообщение выше.
        </p>
      </SectionCard>

      {deadlines && deadlines.fix_deadlines.length > 0 ? (
        <SectionCard title="Сроки устранения замечаний" description="Оргкомитет даёт не более двух рабочих дней на исправление (п. 7.5 Положения).">
          <ul className="flex flex-col gap-2 text-sm">
            {deadlines.fix_deadlines.map((item) => (
              <li key={item.material_id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2">
                <span>{item.type_title}</span>
                <span className={item.is_open ? 'text-fg' : 'text-danger'}>
                  {item.is_open ? `успеть до ${formatMoscowHuman(item.fix_deadline)}` : 'срок истёк'}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </main>
  );
}
