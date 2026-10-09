import { useEffect } from 'react';

// Метаданные страницы (ТЗ 08, п. 2.4 и 5): заголовок, описание, canonical, OG.
//
// Сборка — одностраничное приложение, поэтому теги проставляются на клиенте.
// Поисковые системы их видят, но для полноценного SEO нужен пререндер
// статических маршрутов при сборке: это отдельный шаг, зафиксирован в отчёте.

const BASE_URL = 'https://lideryprava.ru';

interface SeoOptions {
  title: string;
  description: string;
  /** Путь без домена: '/documents'. */
  path: string;
  /** Разметка schema.org (Organization, Event, FAQPage, BreadcrumbList). */
  jsonLd?: Record<string, unknown>;
}

function setMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.setAttribute('content', content);
}

export function useSeo({ title, description, path, jsonLd }: SeoOptions): void {
  useEffect(() => {
    const fullTitle = `${title} · Лидеры права – 2027`;
    document.title = fullTitle;

    setMeta('name', 'description', description);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:url', `${BASE_URL}${path}`);
    setMeta('property', 'og:image', `${BASE_URL}/assets/og-image.jpg`);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = `${BASE_URL}${path}`;

    const scriptId = 'page-json-ld';
    document.getElementById(scriptId)?.remove();
    if (jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = scriptId;
      script.textContent = JSON.stringify(jsonLd);
      document.head.append(script);
    }
  }, [title, description, path, jsonLd]);
}

/** Разметка организации-учредителя: одна на сайт (ТЗ 08, п. 5). */
export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Межрегиональная общественная организация выпускников Саратовской государственной юридической академии «Ассоциация выпускников СЮИ – СГАП – СГЮА»',
  alternateName: 'Ассоциация выпускников СЮИ – СГАП – СГЮА',
  url: BASE_URL,
  email: 'lidery.prava@mail.ru',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'ул. Мясницкая, д. 48',
    addressLocality: 'Москва',
    postalCode: '107078',
    addressCountry: 'RU',
  },
};

/** Хлебные крошки для внутренних страниц. */
export function breadcrumbs(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${BASE_URL}${item.path}`,
    })),
  };
}
