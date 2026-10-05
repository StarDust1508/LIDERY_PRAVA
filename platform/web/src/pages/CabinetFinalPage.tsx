import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, formatMoscowHuman } from '@shared/index';
import { Alert, Button, CheckboxField, TextAreaField } from '@shared/index';
import { useSeason } from '@/lib/season';
import { useSeo } from '@/lib/seo';
import {
  type CabinetData,
  CabinetContactForm,
  CabinetLayout,
  CabinetLoadError,
  CabinetLoading,
  CabinetSection,
  CabinetSessionLost,
  LockedNote,
  fetchCabinetData,
  finalLockedText,
} from './CabinetActions';

// Раздел личного кабинета «Финал» (ТЗ 06, п. 2 и п. 9.2 Положения): подтверждение
// участия в финале, состав выступающих и примечание для Оргкомитета.
//
// Раздел доступен только командам-финалистам. Остальным он показан с
// объяснением, когда откроется, — раздел не исчезает молча (ТЗ 06, п. 3).

export function CabinetFinalPage() {
  useSeo({
    title: 'Подтверждение участия в финале',
    description:
      'Подтверждение участия команды во втором (финальном) этапе конкурса «Лидеры права – 2027»: состав выступающих и примечание для Оргкомитета.',
    path: '/cabinet/final',
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
        <CabinetLoading label="Открываем раздел «Финал»…" />
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

  return <FinalSection data={data} onReload={load} />;
}

function FinalSection({ data, onReload }: { data: CabinetData; onReload: () => Promise<void> }) {
  const { data: seasonResponse } = useSeason();
  const finalFrom = seasonResponse?.season.final_from ?? null;
  const isFinalist =
    data.team.status === 'finalist' || data.team.status === 'final' || data.team.status === 'winner';
  const confirmationSent = data.team.status === 'final' || data.team.status === 'winner';

  const [speakers, setSpeakers] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDetails([]);
    setNotice(null);
    setFieldError(null);

    if (speakers.length === 0) {
      setFieldError('Отметьте хотя бы одного выступающего — без состава подтверждение не принимается.');
      return;
    }

    setBusy(true);
    try {
      const response = await api.cabinetFinalConfirmation({
        speakers,
        note: note.trim() || null,
      });
      setNotice(`${response.message} Выступающие: ${response.speakers.join(', ')}.`);
      setNote('');
      await onReload();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось подтвердить участие. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CabinetLayout
      data={data}
      title="Финал"
      lead="Подтверждение участия во втором (финальном) этапе: состав выступающих, примечание для Оргкомитета и презентационные материалы."
      onReload={onReload}
    >
      {!isFinalist ? (
        <Alert tone="info" title="Раздел откроется после публикации итогов первого этапа">
          <p>
            Подтверждение участия доступно командам-финалистам. Сейчас команда не в числе финалистов:{' '}
            {finalLockedText(data)}. Пока раздел закрыт, следите за итогами на сводке личного кабинета и в разделе «Дедлайны».
          </p>
          <p className="mt-3">
            <Link to="/cabinet" className="text-accent underline underline-offset-2">
              Вернуться к сводке личного кабинета
            </Link>
          </p>
        </Alert>
      ) : null}

      <LockedNote reason={isFinalist ? null : finalLockedText(data)} />

      {confirmationSent ? (
        <Alert tone="success" title="Участие в финале подтверждено">
          Состав выступающих сохранён в карточке команды. Если состав изменился, отправьте подтверждение заново: прежнее
          значение заменится, а примечание обновится.
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Подтверждение не отправлено" details={details.length > 0 ? details : undefined}>
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <CabinetSection
        title="Срок подтверждения"
        description="Не позднее 7 календарных дней до начала финала (п. 9.2 Положения)."
      >
        <p className="text-sm text-muted">
          {finalFrom
            ? `Ориентир по данным конкурса: финал начинается ${formatMoscowHuman(finalFrom)} — подтверждение нужно отправить не позднее чем за 7 календарных дней до этой даты.`
            : 'Точную дату финала объявляет Оргкомитет. Подтверждение отправляется не позднее чем за 7 календарных дней до начала финала.'}{' '}
          После срока подтверждение принимает Оргкомитет — через форму обращения ниже.
        </p>
      </CabinetSection>

      <CabinetSection
        title="Подтверждение участия"
        description="Отметьте, кто выступает на финале от команды, и добавьте примечание, если оно нужно Оргкомитету."
      >
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <fieldset disabled={!isFinalist || busy} className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-fg">
              Состав выступающих
              <span className="text-accent" aria-hidden="true">
                {' '}
                *
              </span>
              <span className="sr-only-text"> — обязательное поле</span>
            </legend>
            {data.team.participants.map((participant) => (
              <CheckboxField
                key={participant.id}
                id={`final-speaker-${participant.id}`}
                label={`${participant.full_name}${participant.role === 'captain' ? ' — капитан команды' : ''}`}
                checked={speakers.includes(participant.id)}
                onChange={(checked) =>
                  setSpeakers((current) =>
                    checked ? [...current, participant.id] : current.filter((id) => id !== participant.id)
                  )
                }
              />
            ))}
            {fieldError ? (
              <p role="alert" className="text-sm text-danger">
                {fieldError}
              </p>
            ) : null}
          </fieldset>

          <TextAreaField
            id="final-note"
            label="Примечание для Оргкомитета"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            disabled={!isFinalist || busy}
            hint="Например: нужен проектор, участвует представитель организации, выступающий подключается дистанционно."
          />

          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" loading={busy} disabled={!isFinalist || speakers.length === 0}>
              {confirmationSent ? 'Отправить подтверждение заново' : 'Подтвердить участие'}
            </Button>
            {!isFinalist ? (
              <p className="text-sm text-muted">Подтверждение станет доступно после публикации итогов первого этапа.</p>
            ) : speakers.length === 0 ? (
              <p className="text-sm text-muted">Отметьте состав выступающих, чтобы отправить подтверждение.</p>
            ) : (
              <p className="text-sm text-muted">
                Выступающих отмечено: {speakers.length} из {data.team.participants.length}.
              </p>
            )}
          </div>
        </form>
      </CabinetSection>

      <CabinetSection
        title="Презентационные материалы и справка"
        description="Комплект финального этапа загружается в разделе «Конкурсные материалы»."
      >
        <p className="text-sm text-muted">
          Презентационные материалы и справка об обучении (или копия документа об образовании) представляются не
          позднее чем за 7 календарных дней до финала (п. 9.2 Положения). Форматы и сроки указаны рядом с каждым
          материалом.
        </p>
        <p className="mt-3 text-sm">
          <Link to="/cabinet/materials" className="text-accent underline underline-offset-2">
            Перейти к конкурсным материалам
          </Link>
        </p>
      </CabinetSection>

      <CabinetSection
        title="Нужна помощь с финалом?"
        description="Оргкомитет отвечает на адрес электронной почты капитана команды."
      >
        <CabinetContactForm
          showTopic
          defaultTopic="application"
          compactNote="Опишите, что требуется: изменение состава выступающих, технические условия или срок подтверждения."
        />
      </CabinetSection>
    </CabinetLayout>
  );
}
