import type { Config } from 'tailwindcss';

// Тема собрана из токенов дизайн-системы (platform/design/DESIGN.md,
// prototype/assets/tokens.css). Значения живут в CSS-переменных, Tailwind
// только даёт им имена: смена оформления — это замена значений переменных,
// структура классов и компонентов при этом не меняется.
export default {
  // Разметка общей библиотеки лежит в .tsx: без этого расширения Tailwind не
  // видел классы из shared/src/ui.tsx и утилиты вроде pl-8, h-5, w-5 в
  // публичную сборку не попадали — отсюда съехавшие подписи и отступы.
  content: ['./index.html', './src/**/*.{ts,tsx}', '../shared/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        raised: 'var(--surface-raised)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        accent: 'var(--accent)',
        'accent-bright': 'var(--accent-bright)',
        'accent-solid': 'var(--accent-solid)',
        'accent-solid-hover': 'var(--accent-solid-hover)',
        'accent-solid-active': 'var(--accent-solid-active)',
        'on-accent': 'var(--on-accent)',
        danger: 'var(--danger)',
        'danger-tint': 'var(--danger-tint)',
        success: 'var(--success)',
        'success-tint': 'var(--success-tint)',
        warning: 'var(--warning)',
        'warning-tint': 'var(--warning-tint)',
        paper: 'var(--paper)',
        sand: 'var(--sand)',
        ink: 'var(--ink)',
        red: 'var(--red)',
        'red-deep': 'var(--red-deep)',
      },
      fontFamily: {
        text: 'var(--font-text)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        display: 'var(--fs-display)',
        h1: 'var(--fs-h1)',
        h2: 'var(--fs-h2)',
        h3: 'var(--fs-h3)',
        lead: 'var(--fs-lead)',
        body: 'var(--fs-body)',
        sm: 'var(--fs-sm)',
        mono: 'var(--fs-mono)',
        'mono-sm': 'var(--fs-mono-sm)',
      },
      spacing: {
        '1': 'var(--s-1)',
        '2': 'var(--s-2)',
        '3': 'var(--s-3)',
        '4': 'var(--s-4)',
        '5': 'var(--s-5)',
        '6': 'var(--s-6)',
        '7': 'var(--s-7)',
        '8': 'var(--s-8)',
        '9': 'var(--s-9)',
      },
      borderRadius: {
        none: 'var(--r-0)',
        sm: 'var(--r-1)',
        DEFAULT: 'var(--r-2)',
        pill: 'var(--r-pill)',
      },
      maxWidth: {
        container: 'var(--container)',
        measure: 'var(--measure)',
      },
      transitionDuration: {
        DEFAULT: 'var(--dur)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
      },
      boxShadow: {
        flat: 'var(--shadow-flat)',
        lift: 'var(--shadow-lift)',
      },
    },
  },
  plugins: [],
} satisfies Config;
