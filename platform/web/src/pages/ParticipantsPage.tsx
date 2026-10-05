import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type MaterialRequirement,
  PARTICIPANT_CATEGORIES,
  api,
  formatMoscowHuman,
  pluralize,
} from '@shared/index';
import { Alert, SectionCard } from '@shared/index';
import { breadcrumbs, useSeo } from '@/lib/seo';

// Страница «Участникам»: кто может участвовать, как подать заявку и что нужно
// приложить. Состав комплекта берётся из material_requirements — того же
// справочника, по которому сервер проверяет заявку, поэтому страница и приём
// не могут разойтись.

export function ParticipantsPage() {
  const [requirements, setRequirements] = useState<MaterialRequirement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useSeo({
    title: 'Как участвовать',
    description:
      'Требования к участникам конкурса «Лидеры права – 2027»: возраст от 16 до 35 лет, команда от 2 до 4 человек, состав конкурсных материалов и порядок подачи заявки.',
    path: '/participants',
    jsonLd: breadcrumbs([
      { name: 'Главная', path: '/' },
      { name: 'Участникам', path: '/participants' },
    ]),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.materialRequirements('selection');
        if (active) setRequirements(data.requirements);
      } catch {
        if (active) setError('Не удалось загрузить состав конкурсных материалов.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const required = requirements.filter(
    (item) => item.is_required && !['application_form', 'consent_pdn', 'consent_legal_rep'].includes(item.type)
  );

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="mono-label text-muted">Участникам</p>
        <h1 className="mt-2 text-h1 font-semibold tracking-[var(--tr-heading)]">Как участвовать</h1>
        <p className="mt-3 max-w-measure text-muted">
          Заявка подаётся только на этом сайте. Ничего дополнительно отправлять и никуда ехать для регистрации не нужно:
          мастер проведёт по шагам, а заполненный бланк заявки система сформирует сама.
        </p>
      </header>

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <SectionCard title="Кто может участвовать" description="Раздел 4 Положения.">
        <ul className="flex flex-col gap-3 text-sm">
          <li>Возраст — от 16 до 35 лет включительно на дату окончания приёма заявок.</li>
          <li>
            Категории участников:
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              {PARTICIPANT_CATEGORIES.map((category) => (
                <li key={category.value}>{category.title}</li>
              ))}
            </ul>
          </li>
          <li>Юридическое образование не требуется: участвовать могут студенты и специалисты любых направлений.</li>
          <li>Команда — от 2 до 4 человек; единоличное участие допускается по согласованию с Оргкомитетом.</li>
          <li>Один участник может входить только в одну команду сезона; от команды принимается одна инициатива.</li>
          <li>
            Участники младше 18 лет допускаются при наличии согласия законного представителя (Приложение № 11):
            электронная отметка и скан подписанного бланка.
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="Как подать заявку" description="Мастер подачи на сайте — единственный канал.">
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>Заполните сведения о команде и законотворческой инициативе (шаг 1).</li>
          <li>Добавьте участников: первым указывается капитан команды.</li>
          <li>Укажите наставников — не более двух.</li>
          <li>Приложите конкурсные материалы отборочного этапа.</li>
          <li>Отметьте согласия: обработка персональных данных, распространение и лицензия на материалы.</li>
          <li>Проверьте сведения и отправьте заявку — она поступит на техническую проверку.</li>
        </ol>
        <p className="mt-4 text-sm">
          <Link to="/apply" className="text-accent underline underline-offset-2">
            Перейти к подаче заявки
          </Link>
        </p>
      </SectionCard>

      <SectionCard
        title={`Конкурсные материалы (${pluralize(required.length, ['обязательный', 'обязательных', 'обязательных'])})`}
        description="Комплект отборочного этапа по пункту 7.2 Положения. Ссылки на облачные хранилища допускаются только на российские сервисы."
      >
        <ul className="flex flex-col gap-4 text-sm">
          {requirements
            .filter((item) => item.type !== 'application_form' && item.type !== 'consent_pdn')
            .map((item) => (
              <li key={item.type} className="border-b border-border pb-3">
                <p className="font-medium">
                  {item.title}
                  {item.is_required ? '' : ' — необязательно'}
                </p>
                {item.description ? <p className="mt-1 text-muted">{item.description}</p> : null}
                <p className="mt-1 text-muted">
                  Срок: {formatMoscowHuman(item.due_at)}
                  {item.name_template ? ` · имя файла: ${item.name_template}` : ''}
                  {item.allowed_extensions.length > 0 ? ` · форматы: ${item.allowed_extensions.join(', ')}` : ''}
                </p>
              </li>
            ))}
        </ul>
      </SectionCard>

      <SectionCard title="Требования к оформлению" description="Приложения № 3–7 к Положению.">
        <ul className="flex flex-col gap-2 text-sm">
          <li>Приложение № 3 — требования к тексту законопроекта и образец первой страницы.</li>
          <li>Приложение № 4 — требования к пояснительной записке с экономическим обоснованием.</li>
          <li>Приложение № 5 — перечень актов и сравнительная таблица.</li>
          <li>Приложение № 6 — технические требования: форматы .docx и .pdf, шаблон имени файла «Команда_Документ».</li>
          <li>Приложение № 7 — требования к видеоролику (до 5 минут) и презентации.</li>
        </ul>
        <p className="mt-4 text-sm">
          <Link to="/documents" className="text-accent underline underline-offset-2">
            Открыть Приложения № 1–14
          </Link>
        </p>
      </SectionCard>
    </main>
  );
}
