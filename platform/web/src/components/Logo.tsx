// Логотип конкурса (ТЗ 08, п. 8): знак «страница закона» — спинка, три строки
// и акцентная линия. Год в логотип не встроен: сезон указывается рядом словами
// «Сезон 2026/2027».

export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      width={size}
      height={size}
      role="img"
      aria-label="Лидеры права"
      className={className}
      focusable="false"
    >
      <rect width="36" height="36" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="1" />
      <rect x="7" y="8" width="3.4" height="17" fill="var(--fg)" />
      <rect x="12.6" y="8" width="16" height="3.4" fill="var(--fg)" />
      <rect x="12.6" y="14.4" width="11.4" height="3.4" fill="var(--fg)" />
      <rect x="12.6" y="20.8" width="14" height="3.4" fill="var(--fg)" />
      <rect x="7" y="27.6" width="21.6" height="2.6" fill="var(--accent-bright)" />
    </svg>
  );
}

/** Знак с названием конкурса: используется в шапке и подвале. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="flex items-center gap-3">
      <LogoMark size={size} />
      <span className="flex flex-col leading-tight">
        <span className="font-semibold tracking-[var(--tr-heading)]">Лидеры права&nbsp;– 2027</span>
        <span className="mono-label text-muted">Сезон 2026/2027</span>
      </span>
    </span>
  );
}
