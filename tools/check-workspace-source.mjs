#!/usr/bin/env node
// Предохранитель источника: в каком каталоге и в какой версии идёт работа.
//
// Зачем: один проект может лежать на машине в нескольких копиях (корень,
// worktree, распакованный архив). Все они выглядят рабочими и собираются без
// ошибок, но прод выпускается только из одного каталога и только из одной ветки.
// Скрипт смотрит на каталог ЗАПУСКА (process.cwd()), поэтому «не тот каталог»
// ловится именно тогда, когда он и бывает опасен.
//
// Запуск:
//   node tools/check-workspace-source.mjs                  — перед работой
//   node tools/check-workspace-source.mjs --against-prod    — перед выпуском
//   node tools/check-workspace-source.mjs --allow-dirty     — если правки ещё не в коммите
//   node tools/check-workspace-source.mjs --server          — сборка на сервере из tar:
//                                                             git-проверки и dist пропускаются,
//                                                             ключевые файлы проверяются

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── настройка под проект ────────────────────────────────────────────────────
const ACTUAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE_MATCH = 'StarDust1508/LIDERY_PRAVA';
const BRANCH = 'feature/lidery-prava-platform';
const DIST_INDEX = 'platform/web/dist/index.html';
const PROD_URL = process.env.PROD_URL || 'https://lideryprava.ru/';
const PROD_API = process.env.PROD_API || 'https://lideryprava.ru/api/health';
const REQUIRED = [
  { file: 'platform/scripts/acceptance.sh', markers: ['проверок'] },
  { file: 'platform/migrations/039_criteria_2026_10_09.sql', markers: ['st1-4'] },
  { file: 'platform/web/src/components/CountUp.tsx', markers: [] },
  { file: 'platform/web/tailwind.config.ts', markers: ["'../shared/src/**/*.{ts,tsx}'"] },
  { file: 'platform/server/src/routes/admin.ts', markers: ['requireAdminForWrites'] },
  { file: 'ops/deploy.sh', markers: ['REPO_DIR'] },
];
// ────────────────────────────────────────────────────────────────────────────

const problems = [];
const notes = [];
// Сервер собирает из распакованного tar: ни .git, ни готового dist там нет —
// проверяем только состав исходников (он и ловит устаревшую версию).
const serverMode = process.argv.includes('--server');
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};
const git = (args) => {
  try {
    return {
      ok: true,
      out: execFileSync('git', ['-C', ACTUAL_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    };
  } catch (error) {
    return { ok: false, out: ((error.stdout || '') + (error.stderr || '')).toString().trim() };
  }
};
const bundleIn = (html) => (html.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [null])[0];

// 1. Каталог запуска совпадает с каталогом выпуска.
const cwd = real(process.cwd());
if (cwd !== real(ACTUAL_ROOT)) {
  problems.push(`запуск из ${cwd}, а выпуск идёт из ${real(ACTUAL_ROOT)} — перейдите в каталог выпуска`);
} else {
  notes.push(`каталог: ${cwd}`);
}
const hasGit = fs.existsSync(path.join(ACTUAL_ROOT, '.git'));
if (serverMode && !hasGit) notes.push('режим сервера: исходники из tar, git-проверки пропущены');

// 2. Ветка и удалённый репозиторий.
if (hasGit) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (branch.out !== BRANCH) problems.push(`ветка ${branch.out || '(нет)'}, ожидается ${BRANCH}`);
  const remote = git(['remote', 'get-url', 'origin']);
  if (!remote.out.includes(REMOTE_MATCH)) problems.push(`origin = ${remote.out || '(нет)'}, ожидается репозиторий ${REMOTE_MATCH}`);
  notes.push(`ветка ${branch.out}, коммит ${commit.out}`);
} else if (!serverMode) {
  problems.push('в каталоге выпуска нет .git — это не рабочая копия репозитория (для сборки из tar запускайте с --server)');
}

// 4. Ключевые файлы текущей версии.
for (const { file, markers } of REQUIRED) {
  const full = path.join(ACTUAL_ROOT, file);
  let ok = fs.existsSync(full) && fs.statSync(full).size > 0;
  if (ok && markers.length) {
    const text = fs.readFileSync(full, 'utf8');
    for (const marker of markers) {
      if (!text.includes(marker)) {
        ok = false;
        problems.push(`в ${file} нет признака «${marker}» — версия не та`);
      }
    }
  }
  console.log(`  ${ok ? '✓' : '✗'} ${file}`);
  if (!ok && !problems.some((p) => p.includes(file))) problems.push(`нет ${file}`);
}

// 5. Незакоммиченные правки: выпускать из рабочей копии нельзя.
const status = hasGit ? git(['status', '--porcelain']) : { ok: true, out: '' };
if (status.out && !process.argv.includes('--allow-dirty')) {
  problems.push(`в рабочей копии есть незакоммиченные изменения — закоммитьте или запустите с --allow-dirty:\n${status.out}`);
} else if (status.out) {
  notes.push('рабочая копия с незакоммиченными правками (--allow-dirty)');
}

// 6. Сборка и (по флагу) сверка с продом.
const indexHtml = path.join(ACTUAL_ROOT, DIST_INDEX);
const localBundle = fs.existsSync(indexHtml) ? bundleIn(fs.readFileSync(indexHtml, 'utf8')) : null;
if (!localBundle && !serverMode) {
  problems.push(`нет ${DIST_INDEX} или в нём нет ссылки на бандл — сначала сборка web`);
} else if (!localBundle) {
  notes.push('режим сервера: бандл собирается на месте, проверка dist пропущена');
} else {
  console.log(`  бандл локально: ${localBundle}`);
}

if (process.argv.includes('--against-prod')) {
  try {
    const page = await fetch(PROD_URL, { signal: AbortSignal.timeout(30000) });
    const prodBundle = bundleIn(await page.text());
    console.log(`  бандл на проде: ${prodBundle || '(нет)'}`);
    if (prodBundle !== localBundle) problems.push(`бандл прода ${prodBundle} не совпадает с локальным ${localBundle}`);
    const health = await (await fetch(PROD_API, { signal: AbortSignal.timeout(30000) })).json();
    console.log(`  /api/health: ${health?.data?.status ?? '?'}, версия ${health?.data?.version ?? '?'}`);
    if (health?.data?.status !== 'ok') problems.push('/api/health на проде не отвечает ok');
  } catch (error) {
    problems.push(`не удалось проверить прод: ${error.message}`);
  }
}

for (const note of notes) console.log(`  · ${note}`);

if (problems.length) {
  console.error('\nПРОВЕРКА ИСТОЧНИКА НЕ ПРОЙДЕНА — работа и выпуск запрещены:');
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}
console.log('\nисточник актуален');
