import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { YearMedia } from './HistoryMedia';

// Кликабельная лента сезонов: годы на красной шкале, под шкалой — три кадра
// выбранного года. Наведение/фокус на год плавно меняет кадры (просьба
// заказчика от 26.10.2026).

const FIRST_YEAR = 2017;
const LAST_YEAR = 2027;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, index) => FIRST_YEAR + index);

export function DecadeGallery({
  items,
  year,
  onChange,
}: {
  items: YearMedia[];
  year: string;
  onChange: (year: string) => void;
}) {
  const byYear = useMemo(() => new Map(items.map((item) => [item.year, item])), [items]);
  const active = byYear.get(year);
  const photos = (active?.photos ?? []).slice(0, 3);

  return (
    <div className="decade-gallery">
      <ol className="decade-track" aria-label="Сезоны конкурса">
        {YEARS.map((value, index) => {
          const key = String(value);
          const isActive = key === year;
          const hasMedia = (byYear.get(key)?.photos.length ?? 0) > 0;
          return (
            <li key={key} className={isActive ? 'is-active' : undefined} style={{ '--i': index } as React.CSSProperties}>
              <button
                type="button"
                className="decade-year-button"
                aria-pressed={isActive}
                aria-label={`Сезон ${key}${hasMedia ? '' : ': кадры в архиве'}`}
                onMouseEnter={() => onChange(key)}
                onFocus={() => onChange(key)}
                onClick={() => onChange(key)}
              >
                <span className="decade-tick" aria-hidden="true" />
                <span className="decade-year">{value}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="decade-photos" aria-live="polite">
        {photos.length > 0 ? (
          photos.map((src, index) => (
            <Link key={src} to={`/winners/${year}`} className="decade-photo">
              <img
                src={src}
                alt={`Конкурс «Лидеры права», ${year} год — кадр ${index + 1}`}
                loading="lazy"
                width={800}
                height={533}
              />
            </Link>
          ))
        ) : (
          <p className="decade-empty">
            Кадры сезона {year} ещё в архиве — итоги и фотографии появятся после публикации.
          </p>
        )}
      </div>
    </div>
  );
}
