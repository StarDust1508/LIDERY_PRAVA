import { useRef, type MouseEvent, type ReactNode } from 'react';

// Карточка с «прожектором» под курсором.
//
// Приём из каталога ui.aceternity.com (Card Spotlight): при наведении внутри
// карточки появляется мягкое световое пятно, которое следует за указателем.
// Реализовано без внешних зависимостей: положение пишется в CSS-переменные, а
// сам градиент описан в public.css. На сенсорных экранах и при
// prefers-reduced-motion эффект не включается — карточка просто остаётся собой.

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
}

export function SpotlightCard({ children, className }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  function track(event: MouseEvent<HTMLDivElement>) {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    element.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  }

  return (
    <div ref={ref} className={`spotlight-card${className ? ` ${className}` : ''}`} onMouseMove={track}>
      {children}
    </div>
  );
}
