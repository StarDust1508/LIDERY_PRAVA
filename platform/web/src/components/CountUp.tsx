import { useEffect, useMemo, useRef, useState } from 'react';

// Анимированные числа для блока «Цифры сезона».
//
// Приём из каталога ReactBits (reactbits.dev, компонент CountUp): значение
// «набегает» при появлении блока. Реализовано без внешних зависимостей, чтобы
// не тянуть в сборку библиотеку анимаций ради одного эффекта.
//
// Важно для доступности и поиска: в разметке сразу стоит итоговое значение.
// Анимация только подменяет его на время прокрутки и отключается при
// prefers-reduced-motion.

interface CountUpProps {
  /** Итоговое значение: строка, чтобы сохранить форматы вида «2–4». */
  value: string;
  durationMs?: number;
}

/** Числа в строке: «2017» — одно, «2–4» — два (анимируем первое). */
function parse(value: string): { number: number; suffix: string } | null {
  const match = /^(\d+)(.*)$/.exec(value.trim());
  if (!match) return null;
  return { number: Number(match[1]), suffix: match[2] ?? '' };
}

export function CountUp({ value, durationMs = 900 }: CountUpProps) {
  // Разбор значения мемоизирован по строке: без этого объект создавался заново на
  // каждом рендере, эффект перезапускался вместе с наблюдателем, и число
  // «набегало» бесконечно — заказчик видел плывущие цифры вместо итогового
  // значения, а кадры анимации не прекращались.
  const target = useMemo(() => parse(value), [value]);
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(target ? target.number : null);

  // Ширина значения зарезервирована под итоговое число: пока идёт «набегание»,
  // блок не дёргается, потому что подпись под ним остаётся на месте. Расчёт в
  // `ch` опирается на табличные цифры (заданы для `.stat .num`) и годится для
  // значений из цифр и тире; для чисел с разделителями разрядов ширину нужно
  // будет мерить отдельно.
  const holdWidth = { display: 'inline-block', minWidth: `${value.length}ch` } as const;

  useEffect(() => {
    if (!target) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const element = ref.current;
    if (reduced || !element || typeof IntersectionObserver === 'undefined') {
      setShown(target.number);
      return;
    }

    let frame = 0;
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        const start = performance.now();
        const tick = (now: number): void => {
          const progress = Math.min(1, (now - start) / durationMs);
          // Плавное замедление в конце: значение «доезжает», а не обрывается.
          const eased = 1 - (1 - progress) ** 3;
          setShown(Math.round(target.number * eased));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        setShown(0);
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs]);

  if (!target)
    return (
      <span ref={ref} style={holdWidth}>
        {value}
      </span>
    );
  return (
    <span ref={ref} style={holdWidth}>
      {shown ?? target.number}
      {target.suffix}
    </span>
  );
}
