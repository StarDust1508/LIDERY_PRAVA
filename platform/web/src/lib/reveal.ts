import { useEffect } from 'react';

// Появление блоков при прокрутке.
//
// Инвариант, из-за которого этот код написан осторожно: содержимое страницы
// видно всегда. Анимация включается не при загрузке, а при первой прокрутке
// (или через 8 секунд, если участник только читает первый экран). До этого
// момента класса `.is-motion` на корне нет, а скрывать блоки умеет только он.
//
// Почему не «включаем сразу»: браузер в момент загрузки может ещё не знать
// итоговый размер окна, и блок первого экрана, ошибочно признанный «ниже сгиба»,
// оставался невидимым. Здесь к моменту включения окно измерено точно.
//
// При включении блоки, видимые в кадре, сразу помечаются классом `.is-in` — они
// не мигают. Скрываются и уходят под наблюдение только те, что ниже сгиба.

const ARM_DELAY_MS = 8000;

/**
 * Высота экрана для разбора блоков.
 *
 * Нижняя граница 600 px — не украшение: при первой отрисовке браузер может
 * сообщить ещё не установившуюся высоту окна (или высоту скрытого окна), и блок
 * первого экрана был бы ошибочно скрыт как «ниже сгиба». Реальный экран меньше
 * 600 px по высоте практически не встречается, поэтому такая граница безопасна.
 */
function viewportHeight(): number {
  return Math.max(window.innerHeight, window.visualViewport?.height ?? 0, 600);
}

export function useReveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.site');
    if (!root) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );

    let armed = false;

    const scan = () => {
      document.querySelectorAll('.site .reveal:not(.is-in), .site .reveal-x:not(.is-in)').forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < viewportHeight()) {
          node.classList.add('is-in');
          return;
        }
        observer.observe(node);
      });
    };

    const arm = () => {
      if (armed) return;
      armed = true;
      window.removeEventListener('scroll', arm);
      window.clearTimeout(timer);
      root.classList.add('is-motion');
      scan();
    };

    const timer = window.setTimeout(arm, ARM_DELAY_MS);
    window.addEventListener('scroll', arm, { passive: true });

    // Окно изменило размер (поворот телефона, разворот окна) — пересобираем
    // список: то, что попало в кадр, показываем сразу.
    const onResize = () => {
      if (armed) scan();
    };
    window.addEventListener('resize', onResize);

    // Разметка меняется после подгрузки данных: новые блоки разбираются заново,
    // но только когда анимация уже включена.
    let scheduled = 0;
    const mutations = new MutationObserver(() => {
      if (!armed || scheduled) return;
      scheduled = window.setTimeout(() => {
        scheduled = 0;
        scan();
      }, 150);
    });
    mutations.observe(document.getElementById('main') ?? root, { childList: true, subtree: true });

    // Страховка: если наблюдение не сработало, блок в кадре всё равно покажется.
    const safety = window.setInterval(() => {
      if (!armed) return;
      document.querySelectorAll('.site .reveal:not(.is-in), .site .reveal-x:not(.is-in)').forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < viewportHeight() && rect.bottom > 0) node.classList.add('is-in');
      });
    }, 1200);

    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.clearInterval(safety);
      window.clearTimeout(scheduled);
      window.clearTimeout(timer);
      window.removeEventListener('scroll', arm);
      window.removeEventListener('resize', onResize);
      root.classList.remove('is-motion');
    };
  }, []);
}
