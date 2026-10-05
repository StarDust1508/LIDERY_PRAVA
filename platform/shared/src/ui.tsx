import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// UI-примитивы публичной части: кнопка, поля, уведомления, статус, прогресс.
// Требования ТЗ 08, п. 7 выполняются здесь, а не в каждом экране:
// подпись поля всегда видима, ошибка — текстом рядом с полем и через role="alert",
// состояние передаётся текстом, а не только цветом.

function join(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// ── Кнопка ───────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'quiet';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-solid text-on-accent hover:bg-accent-solid-hover active:bg-accent-solid-active disabled:bg-sand disabled:text-muted',
  secondary:
    'border border-border-strong text-fg hover:border-accent hover:text-accent disabled:border-border disabled:text-muted',
  quiet: 'text-accent underline underline-offset-2 hover:text-accent-solid-hover disabled:text-muted',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({ variant = 'primary', loading = false, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={join(
        'mono-label inline-flex min-h-[44px] items-center justify-center gap-2 px-5 transition',
        'disabled:cursor-not-allowed',
        BUTTON_STYLES[variant],
        className
      )}
    >
      {loading ? 'Отправляем…' : children}
    </button>
  );
}

// ── Поля ─────────────────────────────────────────────────────────────────────
interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (aria: { 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined }) => ReactNode;
}

/** Общая оболочка поля: подпись, пояснение, элемент, сообщение об ошибке. */
export function Field({ id, label, hint, error, required = false, children }: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required ? (
          <span className="text-accent" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only-text"> — обязательное поле</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children({ 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS = join(
  'min-h-[44px] w-full border bg-raised px-3 py-2 text-body text-fg transition',
  'placeholder:text-muted',
  'border-border-strong focus:border-accent'
);

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ id, label, hint, error, required, ...rest }: TextFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {(aria) => <input {...rest} {...aria} id={id} required={required} className={CONTROL_CLASS} />}
    </Field>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({ id, label, hint, error, required, ...rest }: TextAreaFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {(aria) => <textarea {...rest} {...aria} id={id} required={required} className={join(CONTROL_CLASS, 'min-h-[120px]')} />}
    </Field>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  options: ReadonlyArray<{ value: string | number; title: string }>;
  placeholder?: string;
};

export function SelectField({ id, label, hint, error, required, options, placeholder, ...rest }: SelectFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {(aria) => (
        <select {...rest} {...aria} id={id} required={required} className={CONTROL_CLASS}>
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.title}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface CheckboxFieldProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  hint?: string;
}

export function CheckboxField({ id, label, checked, onChange, error, hint }: CheckboxFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="mt-1 h-5 w-5 min-w-[20px] accent-[var(--accent-solid)]"
        />
        <label htmlFor={id} className="text-sm text-fg">
          {label}
        </label>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="pl-8 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="pl-8 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Уведомления и статусы ────────────────────────────────────────────────────
type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_STYLES: Record<AlertTone, string> = {
  info: 'border-border-strong bg-raised text-fg',
  success: 'border-success bg-success-tint text-success',
  warning: 'border-warning bg-warning-tint text-warning',
  danger: 'border-danger bg-danger-tint text-danger',
};

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  details?: string[];
}

/** Уведомление. Список замечаний выводится текстом, а не цветом. */
export function Alert({ tone = 'info', title, children, details }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={join('border px-4 py-3 text-sm', ALERT_STYLES[tone])}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children ? <div>{children}</div> : null}
      {details && details.length > 0 ? (
        <ul className="mt-2 list-disc pl-5">
          {details.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  draft: 'border-border-strong text-muted',
  submitted: 'border-warning text-warning',
  tech_check: 'border-warning text-warning',
  tech_rejected: 'border-danger text-danger',
  allowed: 'border-success text-success',
  stage1: 'border-success text-success',
  finalist: 'border-success text-success',
  final: 'border-success text-success',
  winner: 'border-success text-success',
  disqualified: 'border-danger text-danger',
  withdrawn: 'border-danger text-danger',
};

/** Статус текстом и рамкой: цвет не единственный носитель смысла. */
export function StatusBadge({ status, title }: { status: string; title: string }) {
  return (
    <span className={join('mono-label inline-flex border px-2 py-1', STATUS_TONES[status] ?? 'border-border-strong text-muted')}>
      {title}
    </span>
  );
}

// ── Каркас экрана ────────────────────────────────────────────────────────────
export function SectionCard({
  title,
  description,
  children,
  footer,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Панель действий раздела: справа от заголовка (ТЗ 07, п. 1.4). */
  actions?: ReactNode;
}) {
  return (
    <section className="border border-border bg-raised">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-h2 font-semibold">{title}</h2>
          {description ? <p className="mt-1 max-w-measure text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </header>
      <div className="px-5 py-5">{children}</div>
      {footer ? <footer className="border-t border-border px-5 py-4">{footer}</footer> : null}
    </section>
  );
}

export function PageHeader({ eyebrow, title, lead, aside }: { eyebrow?: string; title: string; lead?: string; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div>
        {eyebrow ? <p className="mono-label text-muted">{eyebrow}</p> : null}
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">{title}</h1>
        {lead ? <p className="mt-2 max-w-measure text-muted">{lead}</p> : null}
      </div>
      {aside}
    </header>
  );
}

interface ProgressProps {
  steps: ReadonlyArray<{ id: string; title: string }>;
  currentIndex: number;
  onSelect?: (index: number) => void;
}

/** Индикатор шагов мастера: пройденные шаги доступны для возврата. */
export function StepProgress({ steps, currentIndex, onSelect }: ProgressProps) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Шаги подачи заявки">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'пройден' : index === currentIndex ? 'текущий' : 'не начат';
        const isCurrent = index === currentIndex;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={join(
                'mono-label border px-2 py-1',
                isCurrent ? 'border-accent text-accent' : index < currentIndex ? 'border-success text-success' : 'border-border text-muted'
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {index + 1}
            </span>
            {onSelect && index <= currentIndex ? (
              <button type="button" onClick={() => onSelect(index)} className="text-sm text-fg underline underline-offset-2">
                {step.title}
                <span className="sr-only-text"> ({state})</span>
              </button>
            ) : (
              <span className={join('text-sm', isCurrent ? 'text-fg' : 'text-muted')}>
                {step.title}
                <span className="sr-only-text"> ({state})</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
