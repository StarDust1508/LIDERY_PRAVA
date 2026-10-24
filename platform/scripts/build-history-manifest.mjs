#!/usr/bin/env node
// Собирает медиаленту сезонов из файлов public/assets/history/<год>/ и
// public/assets/videos/. Результат — web/src/content/history-media.ts.
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const historyDir = join(root, 'public/assets/history');
const videosDir = join(root, 'public/assets/videos');
const out = join(root, 'web/src/content/history-media.ts');

const TEXTS = {
  '2017': 'Первый сезон конкурса: заявки студентов и первые законотворческие инициативы.',
  '2018': 'Второй сезон: первые команды из Саратовской области, защита инициатив перед экспертным сообществом.',
  '2019': 'Конкурс выходит за пределы одного региона, появляются наставники-практики.',
  '2020': 'Дистанционный формат этапов и работа команд из разных субъектов Российской Федерации.',
  '2021': 'Пятый сезон: в конкурсе 19 команд, финал в СГЮА, победитель — команда «СССР».',
  '2022': 'Инициативы участников направляются субъектам права законодательной инициативы.',
  '2023': 'Седьмой сезон: 98 заявок, 20 команд из 16 регионов, победитель — Юридическая школа ДВФУ.',
  '2024': 'Финал в Москве: групповые выступления, дебаты и Гранд-финал.',
  '2025': 'Девятый сезон: расширение состава Конкурсной комиссии и партнёрской программы.',
  '2026': 'Десятый, юбилейный сезон: победитель — команда «КиберЪОко» (ДВЮИ Университета прокуратуры).',
};
const YEARS = Object.keys(TEXTS);

const items = [];
for (const year of YEARS) {
  const dir = join(historyDir, year);
  const photos = [];
  if (existsSync(dir)) {
    const files = readdirSync(dir)
      .filter((name) => /^history-\d{4}-\d{2}\.jpg$/.test(name))
      .sort();
    for (const file of files) photos.push(`/assets/history/${year}/${file}`);
  }
  // Старые одиночные кадры (присланы 23.10.2026) — для годов без каталога.
  if (photos.length === 0 && existsSync(join(historyDir, `history-${year}.jpg`))) {
    photos.push(`/assets/history/history-${year}.jpg`);
  }
  const video = join(videosDir, `history-${year}.mp4`);
  const poster = join(videosDir, `history-${year}-poster.jpg`);
  items.push({
    year,
    text: TEXTS[year],
    photos,
    video: existsSync(video) ? `/assets/videos/history-${year}.mp4` : null,
    poster: existsSync(poster) ? `/assets/videos/history-${year}-poster.jpg` : null,
  });
}

const withMedia = items.filter((item) => item.photos.length > 0 || item.video);
const source = `// Сгенерировано scripts/build-history-manifest.mjs — не редактировать вручную.
import type { YearMedia } from '@/components/HistoryMedia';

export const HISTORY_MEDIA: YearMedia[] = ${JSON.stringify(items, null, 2)};
export const HISTORY_EMPTY_YEARS = ${JSON.stringify(
  items.filter((item) => item.photos.length === 0 && !item.video).map((item) => item.year)
)};
`;
writeFileSync(out, source, 'utf8');
console.log(
  `манифест: ${withMedia.length} лет с медиа, ${withMedia.reduce((n, i) => n + i.photos.length, 0)} фото, ` +
    `${withMedia.filter((i) => i.video).length} видео; пустые годы: ${items
      .filter((item) => item.photos.length === 0 && !item.video)
      .map((item) => item.year)
      .join(', ')}`
);
