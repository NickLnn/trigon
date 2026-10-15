import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { isTextFile } from '@trigon/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { documents } from '../db/schema';
import { StorageService } from '../files/storage.service';
import { SettingsService } from '../settings/settings.service';
import { fileKind, officeText, tidy } from './extract';
import { ocrImage, ocrPdfPages, pdfPages, toolsAvailable } from './tools';

/** A PDF page with fewer letters than this in its text layer is treated as a scan. */
const SCANNED_PAGE_CHARS = 25;
/** Images larger than this are skipped (huge photos cost a lot of memory to OCR). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type Source = 'text' | 'ocr' | 'empty' | 'unsupported' | 'failed';

/**
 * Makes uploaded files searchable by reading their text into documents.text_content, one file at a
 * time in the background: text files and Office documents directly, PDFs through their text layer,
 * and scanned pages / images through OCR. Files waiting have text_indexed_at = null.
 */
@Injectable()
export class TextIndexService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TextIndexService.name);
  private running = false;
  private again = false;
  private stopped = false;
  private startTimer?: NodeJS.Timeout;
  /** Title of the file being read. */
  current: string | null = null;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    // Let the app finish starting first; then catch up on files uploaded before this feature existed.
    this.startTimer = setTimeout(() => this.kick(), 15_000);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.startTimer);
  }

  /** Process waiting files (no-op if already running; it will pick up new ones). */
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.loop();
  }

  /** Read files again: all of them, or only PDFs and images (after OCR settings or languages change). */
  async reindex(scope: 'all' | 'scans') {
    const scans = sql`(${documents.mimeType} = 'application/pdf' or ${documents.mimeType} like 'image/%' or lower(${documents.title}) ~ '\\.(pdf|png|jpe?g|tiff?|webp|bmp)$')`;
    const rows = await this.db
      .update(documents)
      .set({ textIndexedAt: null, updatedAt: sql`${documents.updatedAt}` })
      .where(and(eq(documents.kind, 'file'), isNull(documents.deletedAt), scope === 'scans' ? scans : undefined))
      .returning({ id: documents.id });
    this.kick();
    return rows.length;
  }

  private async loop() {
    this.running = true;
    try {
      do {
        this.again = false;
        while (!this.stopped) {
          const [doc] = await this.db
            .select({ id: documents.id, title: documents.title, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes, storageKey: documents.storageKey })
            .from(documents)
            .where(and(eq(documents.kind, 'file'), isNull(documents.textIndexedAt), isNull(documents.deletedAt), isNotNull(documents.storageKey)))
            .orderBy(asc(documents.createdAt))
            .limit(1);
          if (!doc) break;
          await this.index(doc as typeof doc & { storageKey: string });
        }
      } while (this.again && !this.stopped);
    } catch (err) {
      this.logger.error(`Text indexing stopped: ${(err as Error).message}`);
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  private async index(doc: { id: string; title: string; mimeType: string | null; sizeBytes: number | null; storageKey: string }) {
    this.current = doc.title;
    let text = '';
    let source: Source;
    try {
      ({ text, source } = await this.extract(doc));
    } catch (err) {
      this.logger.warn(`Could not read text from "${doc.title}": ${(err as Error).message.split('\n')[0]}`);
      source = 'failed';
    }
    text = tidy(text);
    if (!text && source !== 'unsupported' && source !== 'failed') source = 'empty';
    // Only if the blob is still the one we read (a text file may have been edited meanwhile); keep updated_at as is.
    await this.db
      .update(documents)
      .set({ textContent: text || null, textSource: source, textIndexedAt: new Date(), updatedAt: sql`${documents.updatedAt}` })
      .where(and(eq(documents.id, doc.id), eq(documents.storageKey, doc.storageKey)));
  }

  private async extract(doc: { title: string; mimeType: string | null; sizeBytes: number | null; storageKey: string }): Promise<{ text: string; source: Source }> {
    const kind = fileKind(doc.title, doc.mimeType, isTextFile(doc.title, doc.mimeType));
    const path = this.storage.pathFor(doc.storageKey);
    const tools = await toolsAvailable();
    const ocr = await this.settings.get('search');
    const canOcr = ocr.ocrEnabled && tools.ocr && ocr.ocrLanguages.length > 0;

    switch (kind) {
      case 'text':
        return { text: (await this.storage.read(doc.storageKey)).subarray(0, 4_000_000).toString('utf8'), source: 'text' };
      case 'docx':
      case 'xlsx':
      case 'pptx':
      case 'odf':
        return { text: officeText(await this.storage.read(doc.storageKey), kind), source: 'text' };
      case 'pdf': {
        if (!tools.pdf) return { text: '', source: 'unsupported' };
        const pages = await pdfPages(path);
        const scanned = pages.map((p, i) => (p.replace(/\s/g, '').length < SCANNED_PAGE_CHARS ? i + 1 : 0)).filter(Boolean);
        if (!scanned.length || !canOcr) return { text: pages.join('\n\n'), source: 'text' };
        const read = await ocrPdfPages(path, scanned.slice(0, ocr.ocrMaxPages), ocr.ocrLanguages);
        return { text: pages.map((p, i) => read.get(i + 1) ?? p).join('\n\n'), source: 'ocr' };
      }
      case 'image':
        if (!canOcr || (doc.sizeBytes ?? 0) > MAX_IMAGE_BYTES) return { text: '', source: 'unsupported' };
        return { text: await ocrImage(path, ocr.ocrLanguages), source: 'ocr' };
      default:
        return { text: '', source: 'unsupported' };
    }
  }
}
