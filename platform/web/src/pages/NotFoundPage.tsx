import { Link } from 'react-router-dom';

/** Честный 404: несуществующий путь не отдаёт главную (ТЗ 08, п. 2.4). */
export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-container flex-col justify-center gap-5 px-6">
      <p className="mono-label text-muted">Ошибка 404</p>
      <h1 className="text-display font-semibold tracking-[var(--tr-display)]">Страница не найдена</h1>
      <p className="max-w-measure text-muted">
        Возможно, адрес введён с опечаткой или страница переехала. Подать заявку можно на странице «Подать заявку», войти в
        личный кабинет — на странице входа.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link to="/apply" className="mono-label border border-border-strong px-5 py-3 hover:border-accent hover:text-accent">
          Подать заявку
        </Link>
        <Link to="/cabinet/access" className="mono-label border border-border-strong px-5 py-3 hover:border-accent hover:text-accent">
          Личный кабинет
        </Link>
      </div>
    </main>
  );
}
