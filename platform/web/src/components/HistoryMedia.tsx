import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Медиалента сезонов: сначала видео года (если есть), затем фотографии.
// Листается стрелками; клавиатура поддерживается (←/→). Годы без материалов
// показывают типографический «пустой кадр» — архив пополняется.

export interface YearMedia {
  year: string;
  text: string;
  video?: string | null;
  poster?: string | null;
  photos: string[];
}

/** Сколько слайдов в ленте года: видео (если есть) + фотографии. */
function slideCount(item: YearMedia): number {
  return (item.video ? 1 : 0) + item.photos.length;
}

export function HistoryMedia({ items, initialYear }: { items: YearMedia[]; initialYear?: string }) {
  const [activeYear, setActiveYear] = useState(initialYear ?? items[items.length - 1]?.year ?? '');
  const active = items.find((item) => item.year === activeYear) ?? items[0];
  const [slide, setSlide] = useState(0);

  const total = active ? slideCount(active) : 0;
  const hasVideo = Boolean(active?.video);
  const photoIndex = hasVideo ? slide - 1 : slide;
  const currentPhoto = active && photoIndex >= 0 ? active.photos[photoIndex] : undefined;

  useEffect(() => {
    setSlide(0);
  }, [activeYear]);

  const go = useCallback(
    (delta: number) => {
      if (total === 0) return;
      setSlide((value) => (value + delta + total) % total);
    },
    [total]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!active) return null;

  const hasMedia = total > 0;

  return (
    <div className="history-media">
      <ol className="timeline-years reveal" aria-label="Годы конкурса">
        {items.map((item) => (
          <li key={item.year}>
            <button
              type="button"
              className={`timeline-year${item.year === activeYear ? ' is-active' : ''}`}
              aria-pressed={item.year === activeYear}
              onClick={() => setActiveYear(item.year)}
            >
              {item.year}
            </button>
          </li>
        ))}
      </ol>

      <div className="timeline-stage reveal">
        <div className="history-stage">
          {hasMedia ? (
            <>
              <div className="history-stage-wrap">
                <button
                  type="button"
                  className="history-arrow history-nav is-prev"
                  onClick={() => go(-1)}
                  aria-label="Предыдущий кадр"
                  disabled={total < 2}
                >
                  ←
                </button>
                <div className="history-frame">
                  {hasVideo && slide === 0 ? (
                    <video
                      key={`video-${active.year}`}
                      className="history-video"
                      src={active.video ?? undefined}
                      poster={active.poster ?? undefined}
                      controls
                      preload="metadata"
                      playsInline
                    />
                  ) : currentPhoto ? (
                    <Link to={`/winners/${active.year}`} className="timeline-photo history-photo">
                      <img
                        key={currentPhoto}
                        src={currentPhoto}
                        alt={`Участники конкурса «Лидеры права» в ${active.year} году`}
                        loading="lazy"
                        width={1600}
                        height={1067}
                      />
                    </Link>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="history-arrow history-nav is-next"
                  onClick={() => go(1)}
                  aria-label="Следующий кадр"
                  disabled={total < 2}
                >
                  →
                </button>
              </div>
              <div className="history-meta">
                <p className="history-counter" role="status">
                  {hasVideo && slide === 0
                    ? `Видео ${active.year}`
                    : `Фото ${photoIndex + 1} из ${active.photos.length}`}
                  <span className="history-total"> · {active.year}</span>
                </p>
                <Link to={`/winners/${active.year}`} className="history-hint">
                  Победители {active.year} года →
                </Link>
              </div>
              <div className="history-dots" aria-hidden="true">
                {Array.from({ length: total }).map((_, index) => (
                  <span key={index} className={index === slide ? 'is-active' : undefined} />
                ))}
              </div>
            </>
          ) : (
            <Link to={`/winners/${active.year}`} className="timeline-photo timeline-empty">
              <span className="timeline-empty-year" aria-hidden="true">
                {active.year}
              </span>
              <span className="timeline-empty-title">Кадр сезона ещё в архиве</span>
              <span className="timeline-empty-note">
                Фотографии и видео {active.year} года появятся здесь, как только их передаст Оргкомитет. Итоги
                сезона — на странице победителей.
              </span>
              <span className="timeline-empty-link">Открыть страницу {active.year} года →</span>
            </Link>
          )}
        </div>
        <p className="timeline-text">{active.text}</p>
      </div>
    </div>
  );
}
