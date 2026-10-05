// Человекочитаемые адреса материалов (ТЗ 08, п. 2.4.5).
//
// Slug формируется из русского названия транслитерацией: «Мастер-класс о
// дебатах» → «master-klass-o-debatah». Требование к адресам — читаемость и
// устойчивость, поэтому результат всегда в нижнем регистре, без знаков
// препинания и длиннее двух символов.

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Преобразует текст в slug. Нелатинские символы, для которых нет правила,
 * отбрасываются: лучше короткий стабильный адрес, чем транслит наугад.
 */
export function slugify(value: string, fallback = 'zapis'): string {
  const lower = String(value ?? '').toLowerCase().trim();
  const transliterated = Array.from(lower)
    .map((character) => TRANSLIT[character] ?? character)
    .join('');

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  return slug.length >= 2 ? slug : fallback;
}

/**
 * Подбирает свободный slug: при совпадении добавляет числовой суффикс.
 * Проверка вынесена в отдельную функцию, потому что адрес должен быть
 * уникальным, а не «почти уникальным».
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
