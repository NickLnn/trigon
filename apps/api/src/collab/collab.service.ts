import { Database as HocuspocusDatabase } from '@hocuspocus/extension-database';
import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis';
import { Server, type Connection, type Extension } from '@hocuspocus/server';
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { clientIp } from '../activity/request-context';
import { TokensService } from '../auth/tokens.service';
import { UserStatusService } from '../auth/user-status.service';
import { Database, InjectDb } from '../db/db.module';
import { documents } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { VersionsService } from '../versions/versions.service';
import { accessRevoked, collabAccess, COLLAB_RECHECK_MS, type CollabAccess, type CollabContext } from './collab-access';

interface PMNode {
  type: string;
  text?: string;
  content?: PMNode[];
}

/** Flatten ProseMirror JSON to plain text (one line per block) for search and embeddings. */
export function proseMirrorText(node: PMNode): string {
  if (node.text) return node.text;
  const inner = (node.content ?? []).map(proseMirrorText);
  const isBlockContainer = (node.content ?? []).some((c) => c.type !== 'text' && c.type !== 'hardBreak');
  return inner.join(isBlockContainer ? '\n' : '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Real-time collaboration: a Hocuspocus (Yjs) WebSocket server on COLLAB_PORT.
 * Document name = Trigon document id. Clients authenticate with a short-lived collab token
 * from GET /auth/collab-token; viewers without 'edit' are connected read-only.
 */
@Injectable()
export class CollabService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabService.name);
  private server?: Server;
  private sweep?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly config: ConfigService,
    private readonly tokens: TokensService,
    private readonly perms: PermissionsService,
    private readonly activity: ActivityService,
    private readonly versions: VersionsService,
    private readonly statuses: UserStatusService,
  ) {}

  async onModuleInit() {
    const port = Number(this.config.get('COLLAB_PORT') ?? 4001);
    const extensions: Extension[] = [
      new HocuspocusDatabase({
        fetch: async ({ documentName }) => {
          const [row] = await this.db.select({ ydoc: documents.ydoc }).from(documents).where(eq(documents.id, documentName));
          return row?.ydoc ? new Uint8Array(row.ydoc) : null;
        },
        store: async ({ documentName, state, document, lastContext }) => {
          try {
            const ctx = lastContext as { userId?: string; ip?: string | null; userAgent?: string | null; restoreNote?: string } | undefined;
            const userId = ctx?.userId;
            // The first save of an imported page only materialises the import (someone opened it), it isn't an edit.
            const [prev] = await this.db
              .select({
                importHtml: documents.importHtml,
                textContent: documents.textContent,
                ydoc: documents.ydoc,
                content: documents.content,
                title: documents.title,
                updatedById: documents.updatedById,
                updatedAt: documents.updatedAt,
              })
              .from(documents)
              .where(eq(documents.id, documentName));
            const json = yXmlFragmentToProsemirrorJSON(document.getXmlFragment('default')) as PMNode;
            const text = proseMirrorText(json).slice(0, 1_000_000);
            await this.db
              .update(documents)
              .set({
                ydoc: Buffer.from(state),
                content: json as unknown as Record<string, unknown>,
                textContent: text,
                // Once an editor has materialised an import into the Yjs doc, the raw HTML is no longer needed.
                importHtml: null,
                updatedById: userId,
              })
              .where(eq(documents.id, documentName));
            // Page history. A failure here must never cost the save itself.
            await this.versions
              .snapshot({
                documentId: documentName,
                userId: userId ?? null,
                state: { title: prev?.title ?? 'Untitled', ydoc: Buffer.from(state), content: json as unknown as Record<string, unknown>, textContent: text },
                before:
                  prev?.ydoc && prev.importHtml === null
                    ? {
                        title: prev.title,
                        ydoc: prev.ydoc,
                        content: prev.content ?? null,
                        textContent: prev.textContent ?? '',
                        authorId: prev.updatedById,
                        at: prev.updatedAt,
                      }
                    : null,
                note: ctx?.restoreNote,
              })
              .catch((err: Error) => this.logger.error(`Saving a version of ${documentName} failed: ${err.message}`));
            if (prev && prev.importHtml === null && !ctx?.restoreNote) {
              this.activity.noteEdit(userId, documentName, {
                before: prev.textContent ?? '',
                after: text,
                client: { ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null },
              });
            }
          } catch (err) {
            // Never lose a save silently.
            this.logger.error(`Saving document ${documentName} failed: ${(err as Error).message}`);
            throw err;
          }
        },
      }),
    ];

    // Redis only matters when several API replicas must share live documents. Its store lock gives up
    // without retrying and then *skips* the save, which lost edits on single-instance installs — so it
    // is opt-in.
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl && this.config.get('COLLAB_REDIS') === 'true') {
      const { hostname, port: redisPort, password } = new URL(redisUrl);
      extensions.push(
        new HocuspocusRedis({ host: hostname, port: Number(redisPort || 6379), options: password ? { password: decodeURIComponent(password) } : {} }),
      );
    }

    this.server = new Server({
      port,
      quiet: true,
      debounce: 2000,
      maxDebounce: 10000,
      extensions,
      onAuthenticate: async ({ token, documentName, connectionConfig, requestHeaders }) => {
        // Hocuspocus turns any throw into a bare "permission-denied" for the client, so log the real reason.
        try {
          const payload = await this.tokens.verify(token).catch((err: Error) => {
            throw Object.assign(new Error(`invalid collab token: ${err.message}`), { reason: 'unauthorized' });
          });
          if (payload.typ !== 'collab') throw Object.assign(new Error('not a collab token'), { reason: 'unauthorized' });
          const access = await this.access(payload.sub, payload.email, documentName);
          if (access === 'none') throw Object.assign(new Error(`no access to ${documentName}`), { reason: 'forbidden' });
          connectionConfig.readOnly = access !== 'write';
          // Kept on the connection so live edits are logged with the editor's address and device.
          const headers = Object.fromEntries(requestHeaders.entries());
          const context: CollabContext = {
            userId: payload.sub,
            email: payload.email,
            ip: clientIp(headers, null),
            userAgent: headers['user-agent']?.slice(0, 400) ?? null,
            checkedAt: Date.now(),
          };
          return context;
        } catch (err) {
          this.logger.warn(`Collab sign-in refused for document ${documentName}: ${(err as Error).message}`);
          throw err;
        }
      },
      // Access is checked again while connected: a revoked share, a deactivated account or a deleted page
      // stops reads and edits within COLLAB_RECHECK_MS, instead of lasting as long as the browser tab.
      beforeHandleMessage: async ({ connection, documentName }) => {
        const ctx = connection.context as CollabContext | undefined;
        if (!ctx?.userId) return; // direct server-side connections (version restore)
        if (Date.now() - ctx.checkedAt < COLLAB_RECHECK_MS) return;
        await this.recheck(connection, documentName);
      },
    });
    this.sweep = setInterval(() => void this.sweepConnections(), COLLAB_RECHECK_MS);
    this.sweep.unref();
    await this.server.listen();
    this.logger.log(`Collaboration server listening on ws://0.0.0.0:${port}`);
  }

  /**
   * Put a page back to an earlier version. Done through the live document, so everyone who has the page
   * open sees it change at once and their next edits build on the restored text.
   */
  async restore(documentId: string, state: Buffer, userId: string, note: string) {
    if (!this.server) throw new Error('The collaboration server is not running');
    const source = new Y.Doc();
    Y.applyUpdate(source, new Uint8Array(state));
    const from = source.getXmlFragment('default');
    const connection = await this.server.hocuspocus.openDirectConnection(documentId, { userId, restoreNote: note });
    try {
      await connection.transact((doc) => {
        const target = doc.getXmlFragment('default');
        target.delete(0, target.length);
        target.insert(0, from.toArray().map((node) => (node as Y.XmlElement | Y.XmlText).clone()));
      });
    } finally {
      await connection.disconnect();
    }
  }

  /** The user's current access to a document (active account, role and grants from the database). */
  private async access(userId: string, email: string, documentName: string): Promise<CollabAccess> {
    const status = await this.statuses.get(userId);
    if (!status?.active) return 'none';
    const { level } = await this.perms.documentLevel({ id: userId, email, role: status.role }, documentName).catch(() => ({ level: null }));
    return collabAccess(status, level);
  }

  /** Re-check one live connection: close it, or switch it to read-only, when access went away. */
  private async recheck(connection: Connection, documentName: string) {
    const ctx = connection.context as CollabContext;
    const access = await this.access(ctx.userId, ctx.email, documentName);
    ctx.checkedAt = Date.now();
    if (access === 'none') {
      this.logger.warn(`Closed live editing of ${documentName} for user ${ctx.userId}: access was revoked`);
      throw accessRevoked(documentName);
    }
    connection.readOnly = access !== 'write';
  }

  /** Idle readers send no messages, so connections are also re-checked on a timer. */
  private async sweepConnections() {
    for (const [name, document] of this.server?.hocuspocus.documents ?? []) {
      for (const connection of document.getConnections()) {
        const ctx = connection.context as CollabContext | undefined;
        if (!ctx?.userId || Date.now() - ctx.checkedAt < COLLAB_RECHECK_MS) continue;
        await this.recheck(connection, name).catch((err: Error & { code?: number; reason?: string }) =>
          connection.close({ code: err.code ?? 4403, reason: err.reason ?? 'permission-denied' }),
        );
      }
    }
  }

  async onApplicationShutdown() {
    if (this.sweep) clearInterval(this.sweep);
    await this.server?.destroy();
  }
}
