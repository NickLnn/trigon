import type { OcrLanguage } from '@trigon/shared';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Thin wrappers around poppler (pdftotext / pdftoppm) and Tesseract, which the Docker image installs.
 * Everything runs at low CPU priority, one thread, with a timeout — reading a scan must never slow the app.
 */

/** Language files shipped in the image (English + Greek, "fast" models). */
const BUILTIN_DIR = process.env.TESSDATA_BUILTIN_DIR ?? '/usr/share/trigon/tessdata';
/** Extra languages the admin drops in (docker-compose maps ./data/tessdata here). */
export const USER_DIR = process.env.TESSDATA_DIR ?? '/data/tessdata';
/** Tesseract reads one folder, so both are linked together here. */
const MERGED_DIR = join(tmpdir(), 'trigon-tessdata');

const TIMEOUT = 120_000;

const NAMES: Record<string, string> = {
  eng: 'English', ell: 'Greek', grc: 'Ancient Greek', deu: 'German', fra: 'French', ita: 'Italian', spa: 'Spanish',
  por: 'Portuguese', nld: 'Dutch', pol: 'Polish', ron: 'Romanian', bul: 'Bulgarian', rus: 'Russian', ukr: 'Ukrainian',
  tur: 'Turkish', ara: 'Arabic', heb: 'Hebrew', srp: 'Serbian', hrv: 'Croatian', slv: 'Slovenian', ces: 'Czech',
  slk: 'Slovak', hun: 'Hungarian', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', sqi: 'Albanian',
  mkd: 'Macedonian', chi_sim: 'Chinese (Simplified)', chi_tra: 'Chinese (Traditional)', jpn: 'Japanese', kor: 'Korean',
};

function run(cmd: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    // `nice` keeps OCR behind the web app and database when the NAS is busy.
    execFile('nice', ['-n', '15', cmd, ...args], { timeout: TIMEOUT, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

let available: Promise<{ pdf: boolean; ocr: boolean }> | null = null;

/** Whether poppler and Tesseract are installed (they are in the Docker image, usually not in local dev). */
export function toolsAvailable() {
  // A missing program shows up as ENOENT (no `nice` either) or exit code 127 from `nice`; other exit codes still mean it exists.
  const exists = (cmd: string, flag: string) =>
    run(cmd, [flag]).then(
      () => true,
      (e: { code?: unknown }) => e.code !== 'ENOENT' && e.code !== 127,
    );
  available ??= Promise.all([exists('pdftotext', '-v'), exists('tesseract', '--version')]).then(([pdf, ocr]) => ({ pdf, ocr }));
  return available;
}

async function traineddata(dir: string): Promise<string[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  return files.filter((f) => /^[a-z_]+\.traineddata$/i.test(f)).map((f) => f.replace(/\.traineddata$/i, ''));
}

/** Installed OCR languages: built-in ones first, then the ones added to data/tessdata. */
export async function languages(): Promise<OcrLanguage[]> {
  const builtin = await traineddata(BUILTIN_DIR);
  const added = (await traineddata(USER_DIR)).filter((c) => !builtin.includes(c) && c !== 'osd');
  return [
    ...builtin.map((code) => ({ code, name: NAMES[code] ?? code, source: 'built-in' as const })),
    ...added.sort().map((code) => ({ code, name: NAMES[code] ?? code, source: 'added' as const })),
  ];
}

/** Link both language folders into one for Tesseract (a file in data/tessdata wins over the built-in one). */
async function tessdataDir(): Promise<string> {
  await rm(MERGED_DIR, { recursive: true, force: true });
  await mkdir(MERGED_DIR, { recursive: true });
  for (const dir of [USER_DIR, BUILTIN_DIR]) {
    for (const code of await traineddata(dir)) {
      await symlink(join(dir, `${code}.traineddata`), join(MERGED_DIR, `${code}.traineddata`)).catch(() => undefined);
    }
  }
  return MERGED_DIR;
}

/** Text layer of a PDF, one entry per page. */
export async function pdfPages(path: string): Promise<string[]> {
  const out = await run('pdftotext', ['-enc', 'UTF-8', path, '-']);
  const pages = out.split('\f');
  if (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop();
  return pages;
}

/** OCR an image file. */
export async function ocrImage(path: string, langs: string[]): Promise<string> {
  return run('tesseract', [path, 'stdout', '--tessdata-dir', await tessdataDir(), '-l', langs.join('+')], { OMP_THREAD_LIMIT: '1' });
}

/** OCR the given (1-based) pages of a PDF, rendering one page at a time to a temporary image. */
export async function ocrPdfPages(path: string, pages: number[], langs: string[]): Promise<Map<number, string>> {
  const tmp = await mkdtemp(join(tmpdir(), 'trigon-ocr-'));
  const dir = await tessdataDir();
  const result = new Map<number, string>();
  try {
    for (const page of pages) {
      const prefix = join(tmp, 'page');
      await run('pdftoppm', ['-r', '200', '-gray', '-png', '-singlefile', '-f', String(page), '-l', String(page), path, prefix]);
      result.set(page, await run('tesseract', [`${prefix}.png`, 'stdout', '--tessdata-dir', dir, '-l', langs.join('+')], { OMP_THREAD_LIMIT: '1' }));
      await rm(`${prefix}.png`, { force: true });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return result;
}
