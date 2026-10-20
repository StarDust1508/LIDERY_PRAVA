import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  LINK_ONLY_MATERIAL_TYPES,
  type Material,
  MATERIAL_STATUS_TITLES,
  api,
  formatFileSize,
  formatMoscowHuman,
  pluralize,
} from '@shared/index';
import { Alert, Button, StatusBadge, TextField } from '@shared/index';
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
  isAutoMaterial,
  KIT_STATE_TONES,
  MaterialFileLine,
  RequirementNotes,
  buildKit,
  deadlinePassedMessage,
  fetchCabinetData,
  fixDeadlineFor,
  kitProgress,
  teamHasMinor,
} from './CabinetActions';

// Раздел личного кабинета «Конкурсные материалы» (ТЗ 06, п. 2.2 и п. 4).
//
// По каждому типу материала: загрузить файл или вставить ссылку, посмотреть
// замечание, перезагрузить, удалить; рядом — требование к формату и объёму.
// Если срок истёк, экран переходит в режим «дедлайн пропущен»: изменение
// блокируется, чтение и связь с Оргкомитетом остаются (ТЗ 06, п. 4).

export function CabinetMaterialsPage() {
  useSeo({
    title: 'Конкурсные материалы',
    description:
      'Комплект конкурсных материалов команды: загрузка файлов и ссылок, замечания Оргкомитета, требования к формату и сроки отборочного этапа конкурса «Лидеры права – 2027».',
    path: '/cabinet/materials',
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
        <CabinetLoading label="Загружаем комплект конкурсных материалов…" />
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

  return <MaterialsSection data={data} onReload={load} />;
}

function MaterialsSection({ data, onReload }: { data: CabinetData; onReload: () => Promise<void> }) {
  const kit = buildKit(data, teamHasMinor(data.team));
  const progress = kitProgress(kit);
  const deadlinePassed = !data.deadlines.is_application_open;
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function upload(type: string, file: File | null, url: string) {
    setError(null);
    setDetails([]);
    setNotice(null);
    setBusyType(type);
    try {
      const form = new FormData();
      form.append('type', type);
      if (file) form.append('file', file);
      if (url.trim() !== '') form.append('external_url', url.trim());
      const response = await api.cabinetUploadMaterial(form);
      setNotice(
        `Материал «${response.type_title}» загружен: версия ${response.version}. Статус — на проверке у Оргкомитета.`
      );
      await onReload();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось загрузить материал. Попробуйте ещё раз.');
      }
    } finally {
      setBusyType(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setError(null);
    setDetails([]);
    setNotice(null);
    setDeleteBusy(true);
    try {
      await api.cabinetDeleteMaterial(deleteTarget.id);
      setNotice(`Материал «${deleteTarget.type_title}» удалён. Версии этого типа остаются в истории загрузок.`);
      setDeleteTarget(null);
      await onReload();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setDetails(caught.details);
      } else {
        setError('Не удалось удалить материал. Попробуйте ещё раз.');
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <CabinetLayout
      data={data}
      title="Конкурсные материалы"
      lead="Комплект отборочного этапа: загрузите файлы и ссылки, посмотрите замечания Оргкомитета и следите за сроком досдачи."
      onReload={onReload}
    >
      {error ? (
        <Alert tone="danger" title="Действие не выполнено" details={details.length > 0 ? details : undefined}>
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {deadlinePassed ? (
        <Alert tone="warning" title="Дедлайн пропущен: изменение материалов недоступно">
          {deadlinePassedMessage(data)} Комплект остаётся доступен для чтения. Если Оргкомитет открыл срок досдачи по
          замечанию, загрузка снова станет доступна — следите за блоком «Ближайший дедлайн» на сводке.
        </Alert>
      ) : null}

      <CabinetSection
        title="Готовность комплекта"
        description="Статусы обязательных материалов отборочного этапа."
      >
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm text-muted">
            Сдано {progress.done} из {progress.total}
            {progress.needsFix > 0
              ? `; требуют исправления: ${pluralize(progress.needsFix, ['материал', 'материала', 'материалов'])}`
              : ''}
            . Срок приёма материалов:{' '}
            {data.deadlines.application_close_at
              ? formatMoscowHuman(data.deadlines.application_close_at)
              : 'уточняется Оргкомитетом'}
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
        </div>
      </CabinetSection>

      {kit.map((item) => (
        <MaterialBlock
          key={item.requirement?.type ?? `extra-${item.title}`}
          data={data}
          item={item}
          deadlinePassed={deadlinePassed}
          busy={busyType !== null && busyType === item.requirement?.type}
          onUpload={(file, url) => void upload(item.requirement?.type ?? '', file, url)}
          onDelete={(material) => setDeleteTarget(material)}
        />
      ))}

      <CabinetSection
        title="Связаться с организаторами"
        description="Используйте эту форму, если срок пропущен или материал нужно заменить после блокировки."
      >
        <CabinetContactForm
          showTopic
          defaultTopic={deadlinePassed ? 'deadline' : 'application'}
          compactNote="Название команды и статус заявки прикладываются к обращению автоматически: Оргкомитету не придётся уточнять контекст."
        />
      </CabinetSection>

      <ConfirmDeleteDialog
        target={deleteTarget}
        busy={deleteBusy}
        onConfirm={() => void remove()}
        onClose={() => setDeleteTarget(null)}
      />
    </CabinetLayout>
  );
}

function MaterialBlock({
  data,
  item,
  deadlinePassed,
  busy,
  onUpload,
  onDelete,
}: {
  data: CabinetData;
  item: KitItem;
  deadlinePassed: boolean;
  busy: boolean;
  onUpload: (file: File | null, url: string) => void;
  onDelete: (material: Material) => void;
}) {
  const type = item.requirement?.type ?? '';
  const isLinkOnly = (LINK_ONLY_MATERIAL_TYPES as readonly string[]).includes(type);
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const current = item.current;
  const fixDeadline = current ? fixDeadlineFor(data, current) : null;
  const fixOpen = fixDeadline !== null && new Date(fixDeadline).getTime() > Date.now();
  // Материал с замечанием можно заменить, пока открыт срок досдачи (п. 7.5).
  const replaceLocked = deadlinePassed && !fixOpen;
  const accepted = item.versions.some((version) => version.status === 'accepted');

  function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    if (isLinkOnly) {
      if (url.trim() === '') {
        setFieldError('Вставьте ссылку на публикацию видеоролика во «ВКонтакте».');
        return;
      }
    } else if (!file) {
      setFieldError('Выберите файл материала.');
      return;
    }
    onUpload(isLinkOnly ? null : file, isLinkOnly ? url : '');
    setUrl('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  const idBase = `material-${type === '' ? 'extra' : type}`;

  return (
    <CabinetSection
      title={item.title}
      description={item.required ? 'Обязательный материал комплекта.' : 'Материал представляется по желанию команды.'}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`mono-label inline-flex border px-2 py-1 ${KIT_STATE_TONES[item.state]}`}>
            {KIT_STATE_TITLES[item.state]}
          </span>
          {item.deadline ? (
            <span className="text-sm text-muted">Срок: {formatMoscowHuman(item.deadline)}</span>
          ) : null}
        </div>

        <RequirementNotes requirement={item.requirement} />

        {current === null ? (
          <p className="text-sm text-muted">Материал ещё не загружен.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {item.versions.map((version) => (
              <li key={version.id} className="border border-border px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <MaterialFileLine material={version} />
                  <StatusBadge
                    status={
                      version.status === 'accepted'
                        ? 'allowed'
                        : version.status === 'needs_fix'
                          ? 'tech_rejected'
                          : 'submitted'
                    }
                    title={MATERIAL_STATUS_TITLES[version.status] ?? version.status}
                  />
                </div>
                <p className="mt-2 text-muted">
                  Загружен {formatMoscowHuman(version.created_at)}
                  {version.reviewed_at ? ` · проверен ${formatMoscowHuman(version.reviewed_at)}` : ''}
                </p>
                {version.reviewer_comment ? (
                  <p className="mt-2 border-l-2 border-danger pl-3 text-danger">
                    Замечание Оргкомитета: {version.reviewer_comment}
                  </p>
                ) : null}
                {version.fix_deadline ? (
                  <p className="mt-1 text-muted">
                    Срок досдачи: {formatMoscowHuman(version.fix_deadline)}
                    {new Date(version.fix_deadline).getTime() > Date.now() ? '' : ' — срок истёк'}
                  </p>
                ) : null}
                {version.file_url ? (
                  <p className="mt-2">
                    <a
                      href={version.file_url}
                      className="text-accent underline underline-offset-2"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Посмотреть загруженный файл
                    </a>
                  </p>
                ) : version.external_url ? (
                  <p className="mt-2">
                    <a
                      href={version.external_url}
                      className="text-accent underline underline-offset-2"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Открыть публикацию
                    </a>
                  </p>
                ) : null}
                {version.can_delete ? (
                  <p className="mt-3">
                    <Button variant="quiet" onClick={() => onDelete(version)}>
                      Удалить эту версию
                    </Button>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    {accepted
                      ? 'Принятый материал удалить нельзя — напишите в Оргкомитет.'
                      : 'Удаление недоступно: срок работы с материалами истёк (п. 7.5 Положения).'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {item.requirement !== null && isAutoMaterial(item.requirement.type) ? (
          <Alert tone="info" title={item.state === 'accepted' ? 'Оформлено автоматически' : 'Оформляется в мастере подачи'}>
            {item.requirement.type === 'application_form'
              ? 'Заявка по Приложению № 1 формируется системой из данных команды — загружать её файлом не нужно. Бланк можно скачать в блоке «Бланк заявки».'
              : item.requirement.type === 'consent_pdn'
                ? 'Согласия на обработку персональных данных оформляются электронной отметкой в мастере подачи. Если согласие не отмечено, вернитесь к шагу «Согласия» в мастере.'
                : 'Согласие законного представителя оформляется в мастере подачи; для участников младше 18 лет дополнительно загружается скан в этот комплект.'}
          </Alert>
        ) : item.requirement === null ? (
          <Alert tone="info" title="Загрузка для этого типа недоступна">
            Материал этого типа загружен ранее и сохраняется в комплекте для чтения. Добавить новую версию через личный кабинет
            нельзя: тип не входит в перечень конкурсных материалов отборочного этапа. Если материал нужно заменить,
            напишите в Оргкомитет — форма ниже.
          </Alert>
        ) : replaceLocked ? (
          <Alert tone="warning" title="Изменение недоступно: срок истёк">
            Изменять этот материал после срока нельзя (п. 7.5 Положения). Чтение сохранено. Если материал нужно
            заменить, напишите в Оргкомитет — форма ниже.
          </Alert>
        ) : (
          <form className="flex flex-col gap-4 border border-border px-4 py-4" onSubmit={submit} noValidate>
            <p className="mono-label text-muted">
              {current === null ? 'Загрузить материал' : 'Заменить материал: новая версия'}
            </p>

            {isLinkOnly ? (
              <TextField
                id={`${idBase}-url`}
                label="Ссылка на публикацию во «ВКонтакте»"
                required
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://vk.com/…"
                error={fieldError ?? undefined}
                hint="Файл видеоролика не загружается: принимается ссылка на публикацию (п. 8.3 Положения)."
                disabled={busy}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor={`${idBase}-file`} className="text-sm font-medium text-fg">
                  Файл материала
                  <span className="text-accent" aria-hidden="true">
                    {' '}
                    *
                  </span>
                  <span className="sr-only-text"> — обязательное поле</span>
                </label>
                <input
                  ref={fileInput}
                  id={`${idBase}-file`}
                  type="file"
                  required
                  className="min-h-[44px] w-full border border-border-strong bg-raised px-3 py-2 text-body"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setFieldError(null);
                  }}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${idBase}-file-error` : undefined}
                  disabled={busy}
                />
                {fieldError ? (
                  <p id={`${idBase}-file-error`} role="alert" className="text-sm text-danger">
                    {fieldError}
                  </p>
                ) : null}
              </div>
            )}

            {fixOpen && fixDeadline ? (
              <p className="text-sm text-muted">
                Открыт срок досдачи по замечанию: успеть до {formatMoscowHuman(fixDeadline)}.
              </p>
            ) : null}

            <div>
              <Button type="submit" loading={busy} disabled={busy}>
                {current === null ? 'Загрузить' : 'Загрузить новую версию'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </CabinetSection>
  );
}

function ConfirmDeleteDialog({
  target,
  busy,
  onConfirm,
  onClose,
}: {
  target: Material | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!target && dialog.open) dialog.close();
  }, [target]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-material-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="w-[min(560px,92vw)] border border-border-strong bg-raised p-0 text-fg backdrop:bg-[color-mix(in_srgb,var(--ink)_40%,transparent)]"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="delete-material-title" className="text-h2 font-semibold">
          Удалить материал?
        </h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5 text-sm">
        <p>
          Материал «{target?.type_title ?? '—'}» версии {target?.version ?? '—'} будет удалён из комплекта. Если это была
          единственная версия, материал вернётся в состояние «не сдан».
        </p>
        <p className="text-muted">
          Действие необратимо. Если материал уже принят Оргкомитетом, удаление недоступно — используйте обращение в
          Оргкомитет.
        </p>
        {target?.file_name ? (
          <p className="text-muted">
            Файл: {target.file_name}
            {target.file_size !== null ? `, размер ${formatFileSize(target.file_size)}` : ''}.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 border-t border-border px-5 py-4">
        <Button loading={busy} onClick={onConfirm}>
          Удалить материал
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Отменить
        </Button>
      </div>
    </dialog>
  );
}
