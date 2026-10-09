import type { SVGProps } from 'react';
import {
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowUpRight as LucideArrowUpRight,
  CalendarDays,
  Check as LucideCheck,
  ChevronDown as LucideChevronDown,
  Download as LucideDownload,
  ExternalLink,
  FileText,
  Info as LucideInfo,
  Mail as LucideMail,
  Mic,
  Minus as LucideMinus,
  Phone as LucidePhone,
  Plus as LucidePlus,
  Search as LucideSearch,
  Star as LucideStar,
  Trophy as LucideTrophy,
  Users as LucideUsers,
  X,
} from 'lucide-react';

// Единый набор значков (ТЗ 08, п. 6 и 7).
//
// Раньше значки были нарисованы вручную: у них разъезжалась толщина штриха и
// пропорции, а часть символов оставалась текстовыми («→», «▾»). Теперь значки
// берутся из Lucide — открытого набора с единой сеткой 24×24, оптической
// коррекцией и одинаковыми скруглениями. Имена экспортов сохранены, поэтому
// страницы не пришлось переписывать.
//
// Значок всегда декоративен: смысл несёт подпись рядом, поэтому по умолчанию
// стоит aria-hidden — скринридер не читает «стрелка вниз» дважды.

type IconProps = SVGProps<SVGSVGElement> & {
  /** Размер в пикселях: 16 — в подписях, 20 — в интерфейсе, 24 — в навигации. */
  size?: number;
};

/** Общие параметры: размер, толщина штриха прежнего набора и доступность. */
function base({ size = 20, ...rest }: IconProps) {
  return {
    size,
    strokeWidth: 1.6,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  } as const;
}

export const ArrowRight = (props: IconProps) => <LucideArrowRight {...base(props)} />;
export const ArrowLeft = (props: IconProps) => <LucideArrowLeft {...base(props)} />;
export const ArrowUpRight = (props: IconProps) => <LucideArrowUpRight {...base(props)} />;
export const ChevronDown = (props: IconProps) => <LucideChevronDown {...base(props)} />;
export const Calendar = (props: IconProps) => <CalendarDays {...base(props)} />;
export const Document = (props: IconProps) => <FileText {...base(props)} />;
export const Search = (props: IconProps) => <LucideSearch {...base(props)} />;
export const Users = (props: IconProps) => <LucideUsers {...base(props)} />;
export const Trophy = (props: IconProps) => <LucideTrophy {...base(props)} />;
export const Microphone = (props: IconProps) => <Mic {...base(props)} />;
export const Star = (props: IconProps) => <LucideStar {...base(props)} />;
export const Close = (props: IconProps) => <X {...base(props)} />;
export const Plus = (props: IconProps) => <LucidePlus {...base(props)} />;
export const Minus = (props: IconProps) => <LucideMinus {...base(props)} />;
export const External = (props: IconProps) => <ExternalLink {...base(props)} />;
export const Download = (props: IconProps) => <LucideDownload {...base(props)} />;
export const Check = (props: IconProps) => <LucideCheck {...base(props)} />;
export const Info = (props: IconProps) => <LucideInfo {...base(props)} />;
export const Mail = (props: IconProps) => <LucideMail {...base(props)} />;
export const Phone = (props: IconProps) => <LucidePhone {...base(props)} />;

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
