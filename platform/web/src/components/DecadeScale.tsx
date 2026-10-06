// Летопись конкурса: 2017—2027.
//
// Десять сезонов и текущий год собраны в одну шкалу. Линия прочерчивается при
// появлении блока, деления загораются по одному — это не украшение ради
// украшения: шкала показывает место текущего сезона в истории конкурса, которую
// в прежней вёрстке приходилось читать по шести разрозненным подписям.
//
// Годы берутся из ряда, а не из данных: конкурс проводится ежегодно с 2017 года,
// десятый сезон — 2026/2027 (Положение, п. 1.1).

const FIRST_YEAR = 2017;
const CURRENT_YEAR = 2027;

const YEARS = Array.from({ length: CURRENT_YEAR - FIRST_YEAR + 1 }, (_, index) => FIRST_YEAR + index);

export function DecadeScale({ caption = 'Десять сезонов · 2017—2027' }: { caption?: string }) {
  return (
    <figure className="decade reveal">
      <figcaption className="mono">{caption}</figcaption>
      <ol className="decade-track">
        {YEARS.map((year, index) => (
          <li
            key={year}
            className={year === CURRENT_YEAR ? 'is-current' : undefined}
            style={{ '--i': index } as React.CSSProperties}
          >
            <span className="decade-tick" aria-hidden="true" />
            <span className="decade-year mono">{year}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
