import { PageHeader, Prose, Section } from '@/components/PageBlocks';
import { useSeo } from '@/lib/seo';

// Приложение к Положению по номеру (ТЗ 08, п. 2.1).

export function AppendixPage() {
  useSeo({
    title: 'Приложение к Положению',
    description: 'Приложения № 1–14 к Положению о конкурсе «Лидеры права – 2027».',
    path: '/documents',
  });

  return (
    <main className="mx-auto flex max-w-container flex-col gap-8 px-6 py-12">
      <PageHeader eyebrow="Документы" title="Приложение к Положению" />
      <Section title="Раздел наполняется" description="Содержание готовится Оргкомитетом.">
        <Prose>
          <p>
            Материалы раздела публикуются после утверждения Оргкомитетом. Следите за новостями конкурса и
            обращайтесь с вопросами через раздел «Контакты».
          </p>
        </Prose>
      </Section>
    </main>
  );
}
