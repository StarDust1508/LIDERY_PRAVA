import { useState } from 'react';
import {
  APPEAL_GROUNDS,
  APPEAL_STATUS_TITLES,
  type Appeal,
  ApiError,
  type TeamResponse,
  api,
  formatMoscowHuman,
} from '@shared/index';
import { Alert, Button, CheckboxField, SectionCard, SelectField, TextAreaField } from '@/ui/primitives';

// Действия команды в личном кабинете: обращение в Оргкомитет, апелляция по
// форме Приложения № 14, подтверждение участия в финале и отказ от участия.
// Все проверки сроков и прав выполняются на сервере.

interface CabinetActionsProps {
  team: TeamResponse;
  appeals: Appeal[];
  onReload: () => Promise<void>;
}

export function CabinetActions({ team, appeals, onReload }: CabinetActionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [contactMessage, setContactMessage] = useState('');
  const [appealStage, setAppealStage] = useState<'selection' | 'stage1'>('selection');
  const [appealGrounds, setAppealGrounds] = useState<string>('procedure_violation');
  const [appealText, setAppealText] = useState('');
  const [speakers, setSpeakers] = useState<number[]>([]);
  const [finalNote, setFinalNote] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);

  const isFinalist = team.status === 'finalist' || team.status === 'final';
  const participationClosed = team.status === 'disqualified' || team.status === 'withdrawn';

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await onReload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось выполнить действие.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <Alert tone="danger" title="Действие не выполнено">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <SectionCard
        title="Связаться с Оргкомитетом"
        description="Обращение доступно в любой момент, в том числе после окончания приёма заявок."
      >
        <div className="flex flex-col gap-4">
          <TextAreaField
            id="contact-message"
            label="Текст обращения"
            required
            value={contactMessage}
            onChange={(event) => setContactMessage(event.target.value)}
            maxLength={5000}
            hint="Ответ придёт на адрес электронной почты капитана команды."
          />
          <div>
            <Button
              loading={busy}
              disabled={contactMessage.trim() === ''}
              onClick={() =>
                void run(async () => {
                  await api.cabinetContact(contactMessage.trim());
                  setContactMessage('');
                  return 'Обращение отправлено. Оргкомитет свяжется с капитаном команды.';
                })
              }
            >
              Отправить обращение
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Апелляция по итогам этапа"
        description="Апелляция подаётся капитаном команды в течение двух рабочих дней с момента опубликования протокола этапа (п. 12.1 Положения, форма Приложения № 14)."
      >
        {appeals.length > 0 ? (
          <ul className="mb-6 flex flex-col gap-3 text-sm">
            {appeals.map((appeal) => (
              <li key={appeal.id} className="border-b border-border pb-3">
                <p>
                  {appeal.stage === 'selection' ? 'Отборочный этап' : 'Первый этап'} ·{' '}
                  {APPEAL_STATUS_TITLES[appeal.status] ?? appeal.status}
                </p>
                <p className="text-muted">
                  Подана {formatMoscowHuman(appeal.submitted_at)} · срок подачи до {formatMoscowHuman(appeal.deadline_at)}
                </p>
                {appeal.decision_note ? <p className="mt-1">Решение: {appeal.decision_note}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-sm text-muted">Апелляций команда не подавала.</p>
        )}

        <div className="flex flex-col gap-4">
          <SelectField
            id="appeal-stage"
            label="Этап Конкурса"
            value={appealStage}
            onChange={(event) => setAppealStage(event.target.value as 'selection' | 'stage1')}
            options={[
              { value: 'selection', title: 'Отборочный этап' },
              { value: 'stage1', title: 'Первый этап' },
            ]}
          />
          <SelectField
            id="appeal-grounds"
            label="Предмет апелляции"
            value={appealGrounds}
            onChange={(event) => setAppealGrounds(event.target.value)}
            options={APPEAL_GROUNDS.map((ground) => ({ value: ground.value, title: ground.title }))}
          />
          <TextAreaField
            id="appeal-text"
            label="Мотивированное обоснование"
            required
            value={appealText}
            onChange={(event) => setAppealText(event.target.value)}
            maxLength={10000}
            hint="Укажите конкретные положения Положения, которые, по мнению команды, нарушены."
          />
          <div>
            <Button
              loading={busy}
              disabled={appealText.trim() === '' || participationClosed}
              onClick={() =>
                void run(async () => {
                  const response = await api.cabinetSubmitAppeal({
                    stage: appealStage,
                    grounds: appealGrounds,
                    text: appealText.trim(),
                  });
                  setAppealText('');
                  return `Апелляция подана. Срок рассмотрения — до ${formatMoscowHuman(response.deadline_at)}.`;
                })
              }
            >
              Подать апелляцию
            </Button>
          </div>
        </div>
      </SectionCard>

      {isFinalist ? (
        <SectionCard
          title="Подтверждение участия в финале"
          description="Отметьте состав выступающих (п. 9.2 Положения). Презентационные материалы загружаются в комплект материалов."
        >
          <div className="flex flex-col gap-4">
            {team.participants.map((participant) => (
              <CheckboxField
                key={participant.id}
                id={`speaker-${participant.id}`}
                label={`${participant.full_name}${participant.role === 'captain' ? ' — капитан команды' : ''}`}
                checked={speakers.includes(participant.id)}
                onChange={(checked) =>
                  setSpeakers((current) =>
                    checked ? [...current, participant.id] : current.filter((id) => id !== participant.id)
                  )
                }
              />
            ))}
            <TextAreaField
              id="final-note"
              label="Примечание для Оргкомитета"
              value={finalNote}
              onChange={(event) => setFinalNote(event.target.value)}
              maxLength={2000}
            />
            <div>
              <Button
                loading={busy}
                disabled={speakers.length === 0}
                onClick={() =>
                  void run(async () => {
                    const response = await api.cabinetFinalConfirmation({
                      speakers,
                      note: finalNote.trim() || null,
                    });
                    setFinalNote('');
                    return `Участие подтверждено. Выступающие: ${response.speakers.join(', ')}.`;
                  })
                }
              >
                Подтвердить участие
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {!participationClosed ? (
        <SectionCard
          title="Отказ от участия"
          description="Команда вправе отозвать заявку и отказаться от участия на любом этапе (п. 4.10 Положения). Отзыв согласий прекращает участие (п. 14.3)."
        >
          <div className="flex flex-col gap-4">
            <TextAreaField
              id="withdraw-reason"
              label="Причина отказа (по желанию)"
              value={withdrawReason}
              onChange={(event) => setWithdrawReason(event.target.value)}
              maxLength={1000}
            />
            <CheckboxField
              id="withdraw-confirm"
              label="Подтверждаю отказ от участия в конкурсе и отзыв согласий на обработку персональных данных"
              checked={withdrawConfirmed}
              onChange={setWithdrawConfirmed}
            />
            <div>
              <Button
                variant="secondary"
                loading={busy}
                disabled={!withdrawConfirmed}
                onClick={() =>
                  void run(async () => {
                    const response = await api.cabinetWithdraw(withdrawReason.trim() || null);
                    setWithdrawReason('');
                    setWithdrawConfirmed(false);
                    return response.message;
                  })
                }
              >
                Отказаться от участия
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}
