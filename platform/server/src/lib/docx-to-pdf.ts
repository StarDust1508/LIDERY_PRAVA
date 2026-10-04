import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Конвертация сформированного DOCX в PDF.
//
// Отдельного PDF-движка в зависимостях нет: список зависимостей сервера
// ограничен разделом 1 ТЗ. Используется LibreOffice, если он установлен
// (на сервере — пакет libreoffice-writer). Если программы нет, вызывающий код
// сообщает пользователю, что доступен только DOCX, — молча отдавать пустой
// файл нельзя.

const SOFFICE_BIN = process.env.SOFFICE_BIN ?? 'soffice';
const CONVERT_TIMEOUT_MS = 60_000;

/** Есть ли LibreOffice в системе. Результат кэшируется на время работы процесса. */
let sofficeAvailable: boolean | null = null;

export async function isPdfConversionAvailable(): Promise<boolean> {
  if (sofficeAvailable !== null) return sofficeAvailable;
  try {
    await execFileAsync(SOFFICE_BIN, ['--version'], { timeout: 10_000 });
    sofficeAvailable = true;
  } catch {
    sofficeAvailable = false;
  }
  return sofficeAvailable;
}

/**
 * Конвертирует DOCX в PDF. Возвращает null, если конвертация невозможна:
 * решение о ответе принимает маршрут, а не эта функция.
 */
export async function convertDocxToPdf(docx: Buffer): Promise<Buffer | null> {
  if (!(await isPdfConversionAvailable())) return null;

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'liders-pdf-'));
  const input = path.join(directory, 'form.docx');
  const output = path.join(directory, 'form.pdf');

  try {
    await fs.writeFile(input, docx);
    await execFileAsync(
      SOFFICE_BIN,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        // Свой профиль на каждый вызов: параллельные конвертации не мешают друг другу.
        `-env:UserInstallation=file://${path.join(directory, 'profile')}`,
        '--convert-to',
        'pdf',
        '--outdir',
        directory,
        input,
      ],
      { timeout: CONVERT_TIMEOUT_MS }
    );
    return await fs.readFile(output);
  } catch (error) {
    console.error('Не удалось сформировать PDF через LibreOffice:', (error as Error).message);
    return null;
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
