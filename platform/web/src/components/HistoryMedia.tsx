import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Медиалента сезонов: слева — фотографии года (листаются стрелками и ←/→),
// справа — ролик об этом годе. Годы без материалов показывают типографический
// «пустой кадр» — архив пополняется.

export interface YearMedia {
  year: string;
  text: string;
  video?: string | null;
  poster?: string | null;
  photos: string[];
}

export function HistoryMedia({ items, initialYear }: { items: YearMedia[]; initialYear?: string }) {
  const [activeYear, setActiveYear] = useState(initialYear ?? items[items.length - 1]?.year ?? '');
  const active = items.find((item) => item.year === activeYear) ?? items[0];
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    setPhotoIndex(0);
  }, [activeYear]);

  const photos = active?.photos ?? [];
  const currentPhotoIndex = photos.length > 0 ? photoIndex % photos.length : 0;
  const currentPhoto = photos[currentPhotoIndex];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (photos.length < 2) return;
      if (event.key === 'ArrowLeft') setPhotoIndex((value) => (value - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') setPhotoIndex((value) => (value + 1) % photos.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length]);

  if (!active) return null;

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
        <div className="timeline-media">
          {/* Слева — фотографии года, которые можно листать. */}
          <div className="timeline-photos">
            {active.photos.length > 0 ? (
              <>
                <div className="timeline-photo-frame">
                  <Link to={`/winners/${active.year}`} className="timeline-photo history-photo">
                    <img
                      key={currentPhoto}
                      src={currentPhoto ?? active.photos[0]}
                      alt={`Участники конкурса «Лидеры права» в ${active.year} году`}
                      loading="lazy"
                      width={1600}
                      height={1067}
                    />
                  </Link>
                  <button
                    type="button"
                    className="history-arrow history-nav is-prev"
                    onClick={() => setPhotoIndex((value) => (value - 1 + active.photos.length) % active.photos.length)}
                    aria-label="Предыдущее фото"
                    disabled={active.photos.length < 2}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="history-arrow history-nav is-next"
                    onClick={() => setPhotoIndex((value) => (value + 1) % active.photos.length)}
                    aria-label="Следующее фото"
                    disabled={active.photos.length < 2}
                  >
                    →
                  </button>
                </div>
                <p className="history-counter" role="status">
                  Фото {currentPhotoIndex + 1} из {active.photos.length}
                  <span className="history-total"> · {active.year}</span>
                </p>
              </>
            ) : (
              <div className="timeline-empty">
                <span className="timeline-empty-year" aria-hidden="true">
                  {active.year}
                </span>
                <span className="timeline-empty-title">Кадр сезона ещё в архиве</span>
                <span className="timeline-empty-note">Фотографии {active.year} года появятся после передачи Оргкомитетом.</span>
              </div>
            )}
          </div>

          {/* Справа — ролик об этом годе. */}
          <aside className="timeline-video">
            {active.video ? (
              <video
                key={`video-${active.year}`}
                className="history-video"
                src={active.video ?? undefined}
                poster={active.poster ?? undefined}
                controls
                preload="metadata"
                playsInline
              />
            ) : (
              <div className="timeline-video-empty">
                <span className="mono">Видео {active.year}</span>
                <p>Ролик сезона появится здесь после публикации Оргкомитетом.</p>
              </div>
            )}
          </aside>
        </div>

        <div className="history-meta">
          <Link to={`/winners/${active.year}`} className="history-hint">
            Победители {active.year} года →
          </Link>
        </div>
        <p className="timeline-text">{active.text}</p>
      </div>
    </div>
  );
}
