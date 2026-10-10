import { Database as HocuspocusDatabase } from '@hocuspocus/extension-database';
import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis';
import { Server, type Extension } from '@hocuspocus/server';
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { atLeast } from '@trigon/shared';
import { eq } from 'drizzle-orm';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { TokensService } from '../auth/tokens.service';
import { Database, InjectDb } from '../db/db.module';
import { documents } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';

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

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly config: ConfigService,
    private readonly tokens: TokensService,
    private readonly perms: PermissionsService,
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
            const json = yXmlFragmentToProsemirrorJSON(document.getXmlFragment('default')) as PMNode;
            await this.db
              .update(documents)
              .set({
                ydoc: Buffer.from(state),
                content: json as unknown as Record<string, unknown>,
                textContent: proseMirrorText(json).slice(0, 1_000_000),
                // Once an editor has materialised an import into the Yjs doc, the raw HTML is no longer needed.
                importHtml: null,
                updatedById: (lastContext as { userId?: string } | undefined)?.userId,
              })
              .where(eq(documents.id, documentName));
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
      const { hostname, port: redisPort } = new URL(redisUrl);
      extensions.push(new HocuspocusRedis({ host: hostname, port: Number(redisPort || 6379) }));
    }

    this.server = new Server({
      port,
      quiet: true,
      debounce: 2000,
      maxDebounce: 10000,
      extensions,
      onAuthenticate: async ({ token, documentName, connectionConfig }) => {
        // Hocuspocus turns any throw into a bare "permission-denied" for the client, so log the real reason.
        try {
          const payload = await this.tokens.verify(token).catch((err: Error) => {
            throw Object.assign(new Error(`invalid collab token: ${err.message}`), { reason: 'unauthorized' });
          });
          if (payload.typ !== 'collab') throw Object.assign(new Error('not a collab token'), { reason: 'unauthorized' });
          const user = { id: payload.sub, email: payload.email, role: payload.role };
          const { level } = await this.perms.documentLevel(user, documentName);
          if (!atLeast(level, 'view')) throw Object.assign(new Error(`no access to ${documentName}`), { reason: 'forbidden' });
          connectionConfig.readOnly = !atLeast(level, 'edit');
          return { userId: user.id };
        } catch (err) {
          this.logger.warn(`Collab sign-in refused for document ${documentName}: ${(err as Error).message}`);
          throw err;
        }
      },
    });
    await this.server.listen();
    this.logger.log(`Collaboration server listening on ws://0.0.0.0:${port}`);
  }

  async onApplicationShutdown() {
    await this.server?.destroy();
  }
}
