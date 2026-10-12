import { Injectable } from '@nestjs/common';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { documentVersions } from '../db/schema';

/** Saves by the same person within this window extend their current version instead of adding one. */
export const VERSION_SESSION_MS = 30 * 60_000;
/** Older versions beyond this many per page are dropped. */
export const MAX_VERSIONS_PER_PAGE = 100;

export interface VersionState {
  title: string;
  ydoc: Buffer;
  content: Record<string, unknown> | null;
  textContent: string;
}

/**
 * Page history: snapshots of the collaborative document taken as it is saved. Each person's editing
 * session becomes one version, so the list reads like "Maria, 14:02 · +12 −3 lines".
 */
@Injectable()
export class VersionsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Called after every save of a page. `before` is the page as it was before this save: when a page
   * gets its first version, that earlier state is kept too, so the first edit can always be undone.
   */
  async snapshot(input: {
    documentId: string;
    userId: string | null;
    state: VersionState;
    before: (VersionState & { authorId: string | null; at: Date }) | null;
    /** Force a separate version with this note (restores). */
    note?: string;
  }) {
    const [latest] = await this.db
      .select({ id: documentVersions.id, createdById: documentVersions.createdById, updatedAt: documentVersions.updatedAt, note: documentVersions.note })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, input.documentId))
      .orderBy(desc(documentVersions.updatedAt))
      .limit(1);

    if (!latest && input.before && input.before.textContent.trim()) {
      await this.db.insert(documentVersions).values({
        documentId: input.documentId,
        createdById: input.before.authorId,
        title: input.before.title,
        ydoc: input.before.ydoc,
        content: input.before.content,
        textContent: input.before.textContent,
        note: 'Before history was kept',
        createdAt: input.before.at,
        updatedAt: input.before.at,
      });
    }

    const extend =
      latest && !input.note && !latest.note?.startsWith('Restored') && latest.createdById === input.userId && Date.now() - latest.updatedAt.getTime() < VERSION_SESSION_MS;
    if (extend) {
      await this.db
        .update(documentVersions)
        .set({ ...input.state, updatedAt: new Date() })
        .where(eq(documentVersions.id, latest.id));
    } else {
      await this.db.insert(documentVersions).values({ documentId: input.documentId, createdById: input.userId, note: input.note ?? null, ...input.state });
      await this.prune(input.documentId);
    }
  }

  private async prune(documentId: string) {
    const keep = this.db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.updatedAt))
      .limit(MAX_VERSIONS_PER_PAGE);
    await this.db
      .delete(documentVersions)
      .where(and(eq(documentVersions.documentId, documentId), notInArray(documentVersions.id, sql`(${keep})`)));
  }

  /** Versions of a page, newest first (without the heavy columns). */
  list(documentId: string) {
    return this.db
      .select({
        id: documentVersions.id,
        createdAt: documentVersions.createdAt,
        updatedAt: documentVersions.updatedAt,
        createdById: documentVersions.createdById,
        title: documentVersions.title,
        note: documentVersions.note,
        textContent: documentVersions.textContent,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.updatedAt));
  }

  async get(documentId: string, versionId: string) {
    const [v] = await this.db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.id, versionId)));
    return v ?? null;
  }
}
