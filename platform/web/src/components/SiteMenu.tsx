import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MENU_COLUMNS } from '@/app/nav';
import { Close, External, Mail, Phone, ArrowUpRight } from '@/components/Icon';

// Шторка со всей структурой сайта.
//
// Почему так: прежняя шапка несла одиннадцать равнозначных ссылок, подменю на
// наведении и подпись сезона — в полосе высотой 64 px это читалось как мусор.
// Здесь сверху остаётся только знак и два действия, а структура раскрывается по
// нажатию: пять смысловых колонок, полоса контактов и крупная подача заявки.
//
// Панель всегда в разметке (иначе нечего анимировать) и скрыта через
// visibility:hidden — так ссылки внутри не попадают ни в обход табом, ни в
// дерево доступности. Открытие — плавный clip-path, пункты проявляются по
// очереди через задержку --i.

interface SiteMenuProps {
  open: boolean;
  onClose: () => void;
  applyLabel: string;
  /** Кнопка, к которой возвращается фокус после закрытия. */
  returnFocusTo?: HTMLElement | null;
}

export function SiteMenu({ open, onClose, applyLabel, returnFocusTo }: SiteMenuProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        returnFocusTo?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, returnFocusTo]);

  return (
    <>
      <div
        className={`curtain-scrim${open ? ' is-open' : ''}`}
        onClick={() => {
          onClose();
          returnFocusTo?.focus();
        }}
        aria-hidden="true"
      />

      <div
        id="site-menu"
        className={`curtain${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Разделы сайта"
        aria-hidden={!open}
      >
        <div className="curtain-inner wrap">
          <div className="curtain-head">
            <span className="mono">Все разделы конкурса</span>
            <button
              ref={closeRef}
              type="button"
              className="curtain-close"
              onClick={() => {
                onClose();
                returnFocusTo?.focus();
              }}
            >
              Закрыть <Close size={18} />
            </button>
          </div>

          <nav className="curtain-grid" aria-label="Разделы сайта">
            {MENU_COLUMNS.map((column, columnIndex) => (
              <section className="curtain-col" key={column.title} style={{ '--i': columnIndex } as React.CSSProperties}>
                <h2 className="curtain-col-title">
                  <Link to={column.path} onClick={onClose}>
                    {column.title}
                  </Link>
                </h2>
                <ul>
                  {column.links.map((link, linkIndex) => (
                    <li
                      key={link.path}
                      style={{ '--j': linkIndex } as React.CSSProperties}
                      className="curtain-item"
                    >
                      {link.external ? (
                        <a href={link.path} target="_blank" rel="noreferrer noopener" onClick={onClose}>
                          <span>{link.title}</span>
                          <External size={15} />
                        </a>
                      ) : (
                        <Link to={link.path} onClick={onClose}>
                          <span>{link.title}</span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>

          <div className="curtain-foot">
            <div className="curtain-cta">
              <p>
                Приём заявок десятого конкурса идёт до 11 декабря 2026 года, 23:59 (МСК). Материалы
                загружаются в личном кабинете.
              </p>
              <div className="curtain-actions">
                <Link to="/apply" className="curtain-apply" onClick={onClose}>
                  {applyLabel}
                  <ArrowUpRight size={20} />
                </Link>
                <Link to="/cabinet" className="curtain-cabinet" onClick={onClose}>
                  Личный кабинет
                </Link>
              </div>
            </div>

            <div className="curtain-contacts">
              <a href="mailto:lidery.prava@mail.ru">
                <Mail size={16} />
                lidery.prava@mail.ru
              </a>
              <a href="tel:+79060747313">
                <Phone size={16} />
                +7 (906) 074-73-13
              </a>
              <a href="https://vk.com/lideri.prava2026" target="_blank" rel="noreferrer noopener">
                Сообщество во «ВКонтакте»
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
