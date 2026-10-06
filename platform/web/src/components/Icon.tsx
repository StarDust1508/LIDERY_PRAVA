import type { SVGProps } from 'react';

// Единый набор значков (ТЗ 08, п. 6 и 7).
//
// Раньше значки либо отсутствовали, либо были текстовыми символами («→», «▾»,
// «✺») — они по-разному выглядят в разных шрифтах и системах. Здесь один
// линейный набор: толщина 1.6, скруглённые концы, размер 24×24, цвет берётся из
// текста (currentColor), поэтому значки работают и на светлом, и на тёмном фоне.
//
// Значок всегда декоративен: смысл несёт подпись рядом, поэтому по умолчанию
// стоит aria-hidden — скринридер не читает «стрелка вниз» дважды.

type IconProps = SVGProps<SVGSVGElement> & {
  /** Размер в пикселях: 16 — в подписях, 20 — в интерфейсе, 24 — в навигации. */
  size?: number;
};

function Base({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </Base>
);

export const ArrowLeft = (props: IconProps) => (
  <Base {...props}>
    <path d="M20 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </Base>
);

export const ArrowUpRight = (props: IconProps) => (
  <Base {...props}>
    <path d="M7 17L17 7" />
    <path d="M9 7h8v8" />
  </Base>
);

export const ChevronDown = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);

export const Calendar = (props: IconProps) => (
  <Base {...props}>
    <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
    <path d="M3.5 10h17" />
    <path d="M8 3.5V6M16 3.5V6" />
  </Base>
);

export const Document = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 3.5h7l5 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    <path d="M13 3.5V9h5" />
    <path d="M8.5 13h7M8.5 16.5h5" />
  </Base>
);

export const Search = (props: IconProps) => (
  <Base {...props}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l4.5 4.5" />
  </Base>
);

export const Users = (props: IconProps) => (
  <Base {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.5a3 3 0 0 1 0 5.8" />
    <path d="M17.5 20c0-2.2-.7-3.9-2-5" />
  </Base>
);

export const Trophy = (props: IconProps) => (
  <Base {...props}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
    <path d="M8 5H5.5v1.5A3.5 3.5 0 0 0 9 10" />
    <path d="M16 5h2.5v1.5A3.5 3.5 0 0 1 15 10" />
    <path d="M12 13v4M8.5 20h7" />
  </Base>
);

export const Microphone = (props: IconProps) => (
  <Base {...props}>
    <rect x="9" y="3" width="6" height="10" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21M8.5 21h7" />
  </Base>
);

export const Star = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4l2.3 5 5.2.6-3.9 3.6 1 5.2L12 15.8 7.4 18.4l1-5.2-3.9-3.6 5.2-.6L12 4Z" />
  </Base>
);

export const Close = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const Plus = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const Minus = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12h14" />
  </Base>
);

export const External = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Base>
);

export const Download = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4v11" />
    <path d="M7.5 11l4.5 4.5 4.5-4.5" />
    <path d="M5 20h14" />
  </Base>
);

export const Check = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Base>
);

export const Info = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.4" />
  </Base>
);

export const Mail = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Base>
);

export const Phone = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.7 1.5A16.5 16.5 0 0 1 4.5 5.2 1.5 1.5 0 0 1 6 3.5Z" />
  </Base>
);

/** Линия-акцент: растёт при появлении блока (см. .rule-grow в public.css). */
export const AccentLine = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 120 2" preserveAspectRatio="none" className={className} aria-hidden="true">
    <line x1="0" y1="1" x2="120" y2="1" pathLength={1} stroke="currentColor" strokeWidth="2" />
  </svg>
);

/** Дуга: декоративный элемент фона, рисуется при появлении блока. */
export const Arc = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 400 200" className={className} aria-hidden="true" fill="none">
    <path pathLength={1} d="M0 200C0 89.5 89.5 0 200 0s200 89.5 200 200" stroke="currentColor" strokeWidth="1" />
    <path pathLength={1} d="M40 200C40 111.6 111.6 40 200 40s160 71.6 160 160" stroke="currentColor" strokeWidth="1" />
  </svg>
);
