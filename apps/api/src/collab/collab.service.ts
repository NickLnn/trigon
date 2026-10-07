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
          const json = yXmlFragmentToProsemirrorJSON(document.getXmlFragment('default')) as PMNode;
          await this.db
            .update(documents)
            .set({
              ydoc: Buffer.from(state),
              content: json as unknown as Record<string, unknown>,
              textContent: proseMirrorText(json).slice(0, 1_000_000),
              updatedById: (lastContext as { userId?: string } | undefined)?.userId,
            })
            .where(eq(documents.id, documentName));
        },
      }),
    ];

    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      // Lets several API replicas share live documents.
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
        const payload = await this.tokens.verify(token).catch(() => null);
        if (!payload || payload.typ !== 'collab') throw new Error('Unauthorized');
        const user = { id: payload.sub, email: payload.email, role: payload.role };
        const { level } = await this.perms.documentLevel(user, documentName);
        if (!atLeast(level, 'view')) throw new Error('Forbidden');
        connectionConfig.readOnly = !atLeast(level, 'edit');
        return { userId: user.id };
      },
    });
    await this.server.listen();
    this.logger.log(`Collaboration server listening on ws://0.0.0.0:${port}`);
  }

  async onApplicationShutdown() {
    await this.server?.destroy();
  }
}
