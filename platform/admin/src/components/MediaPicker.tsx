import { useEffect, useRef, useState } from 'react';
import { type AdminMediaFile, AdminApiError, adminApi } from '@shared/index';
import { Button, Field } from '@shared/index';

// Выбор файла для полей вида «логотип», «фотография», «PDF Положения».
//
// До этого поля требовали UUID файла, а загрузить файл было негде: раздел
// «Медиафайлы» в API существовал, но интерфейса не имел (аудит админки, Б3).
// Компонент закрывает весь путь: выбрать файл с диска, загрузить, увидеть
// превью, заменить или очистить значение поля.

interface MediaPickerProps {
  id: string;
  label: string;
  hint?: string;
  /** Значение поля: идентификатор файла или пустая строка. */
  value: string;
  onChange: (value: string) => void;
  /** Категория хранилища: документ, изображение, обложка и т. п. */
  category?: string;
  /** Публичный файл отдаётся по прямой ссылке, приватный — только с правами. */
  isPublic?: boolean;
}

/** Картинка это или документ: от этого зависит превью. */
function isImage(file: AdminMediaFile | null): boolean {
  return Boolean(file && file.file_type.startsWith('image/'));
}

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function MediaPicker({ id, label, hint, value, onChange, category = 'document', isPublic = true }: MediaPickerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState<AdminMediaFile | null>(null);
  const [library, setLibrary] = useState<AdminMediaFile[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Текущий файл читаем из списка: отдельного «GET /media/:id» нет, а список
  // ограничен 500 последними файлами — для выбора этого достаточно.
  useEffect(() => {
    let active = true;
    if (value === '') {
      setCurrent(null);
      return;
    }
    void (async () => {
      try {
        const files = await adminApi.mediaList();
        if (active) setCurrent(files.find((file) => file.id === value) ?? null);
      } catch {
        // Ошибка чтения списка не мешает работать с уже выбранным значением.
      }
    })();
    return () => {
      active = false;
    };
  }, [value]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const uploaded = await adminApi.mediaUpload(file, { category, isPublic });
      onChange(uploaded.id);
      setCurrent(uploaded);
      setNotice(`Файл «${uploaded.file_name}» загружен.`);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось загрузить файл.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function openLibrary() {
    setBusy(true);
    setError(null);
    try {
      setLibrary(await adminApi.mediaList());
      setShowLibrary(true);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить список файлов.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!current) return;
    setError(null);
    try {
      const link = await adminApi.mediaLink(current.id);
      const url = `${window.location.origin}${link.path}`;
      await navigator.clipboard?.writeText(url);
      setNotice(`Ссылка скопирована, действует ${Math.round(link.expires_in / 60)} мин.`);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Не удалось получить ссылку.');
    }
  }

  return (
    <Field id={id} label={label} hint={hint}>
      {(aria) => (
        <div className="flex flex-col gap-3" {...aria}>
          {current ? (
            <div className="flex flex-wrap items-start gap-4 border border-border p-3">
              {isImage(current) ? (
                <img
                  src={current.file_url}
                  alt=""
                  className="h-20 w-20 border border-border object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="mono-label text-muted">{current.file_type || 'файл'}</span>
              )}
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
                <span className="font-medium break-all">{current.file_name}</span>
                <span className="text-muted">
                  {humanSize(current.file_size)}
                  {current.is_public ? ' · публичный' : ' · приватный'}
                </span>
                <a className="text-accent underline underline-offset-2" href={current.file_url} target="_blank" rel="noreferrer">
                  Открыть файл
                </a>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void copyLink()}>
                  Ссылка коллеге
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    onChange('');
                    setCurrent(null);
                    setNotice('Файл откреплён от записи.');
                  }}
                >
                  Очистить
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Файл не выбран.</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              id={id}
              type="file"
              className="block text-sm"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button type="button" variant="secondary" loading={busy} onClick={() => void openLibrary()}>
              Выбрать из загруженных
            </Button>
          </div>

          {showLibrary ? (
            <div className="max-h-72 overflow-y-auto border border-border p-3">
              {library.length === 0 ? (
                <p className="text-sm text-muted">В хранилище пока нет файлов.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {library.map((file) => (
                    <li key={file.id} className="flex flex-wrap items-center gap-3 border-b border-border pb-2 text-sm">
                      <span className="min-w-0 flex-1 break-all">{file.file_name}</span>
                      <span className="text-muted">{humanSize(file.file_size)}</span>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          onChange(file.id);
                          setCurrent(file);
                          setShowLibrary(false);
                          setNotice(`Выбран файл «${file.file_name}».`);
                        }}
                      >
                        Выбрать
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Button type="button" variant="quiet" onClick={() => setShowLibrary(false)}>
                  Закрыть список
                </Button>
              </div>
            </div>
          ) : null}

          {notice ? (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Field>
  );
}
