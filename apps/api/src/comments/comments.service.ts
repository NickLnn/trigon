import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { atLeast, COMMENT_MAX, type CommentsResponse, type CommentThread } from '@trigon/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { commentThreads, comments, documents, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';

export interface NewThread {
  body: string;
  anchorFrom?: string | null;
  anchorTo?: string | null;
  quote?: string | null;
}

/**
 * Discussions on pages. Reading needs 'view'; starting threads, replying and resolving need 'comment'.
 * People edit their own comments; they delete their own, or any if they manage the page.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly perms: PermissionsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  private cleanBody(body: string) {
    const text = body.replace(/\r\n?/g, '\n').trim();
    if (!text) throw new BadRequestException('Write something first.');
    if (text.length > COMMENT_MAX) throw new BadRequestException(`Comments can be at most ${COMMENT_MAX} characters.`);
    return text;
  }

  /** The page (not deleted, a page rather than a file/folder) and the viewer's access to it. */
  private async page(user: AuthUser, documentId: string, required: 'view' | 'comment') {
    const [doc] = await this.db
      .select({ id: documents.id, title: documents.title, kind: documents.kind, spaceId: documents.spaceId })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
    if (!doc) throw new NotFoundException();
    const { level } = await this.perms.documentLevel(user, documentId);
    if (!atLeast(level, required)) throw new ForbiddenException(required === 'view' ? 'You can’t open this page.' : 'You need comment access to this page to do that.');
    if (doc.kind !== 'page') throw new BadRequestException('Comments are available on pages.');
    return { ...doc, level: level! };
  }

  private async thread(threadId: string) {
    const [t] = await this.db.select().from(commentThreads).where(eq(commentThreads.id, threadId));
    if (!t) throw new NotFoundException();
    return t;
  }

  async list(user: AuthUser, documentId: string): Promise<CommentsResponse> {
    const page = await this.page(user, documentId, 'view');
    const threads = await this.db.select().from(commentThreads).where(eq(commentThreads.documentId, documentId)).orderBy(asc(commentThreads.createdAt));
    const rows = threads.length
      ? await this.db
          .select({ id: comments.id, threadId: comments.threadId, body: comments.body, createdAt: comments.createdAt, editedAt: comments.editedAt, authorId: comments.authorId, authorName: users.displayName })
          .from(comments)
          .leftJoin(users, eq(users.id, comments.authorId))
          .where(inArray(comments.threadId, threads.map((t) => t.id)))
          .orderBy(asc(comments.createdAt))
      : [];
    const resolverIds = [...new Set(threads.map((t) => t.resolvedById).filter((id): id is string => !!id))];
    const resolvers = resolverIds.length ? await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, resolverIds)) : [];
    const resolverName = new Map(resolvers.map((r) => [r.id, r.name]));
    const manages = atLeast(page.level, 'manage');
    return {
      canComment: atLeast(page.level, 'comment'),
      threads: threads.map(
        (t): CommentThread => ({
          id: t.id,
          anchorFrom: t.anchorFrom,
          anchorTo: t.anchorTo,
          quote: t.quote,
          resolvedAt: t.resolvedAt?.toISOString() ?? null,
          resolvedBy: t.resolvedById ? (resolverName.get(t.resolvedById) ?? null) : null,
          createdAt: t.createdAt.toISOString(),
          comments: rows
            .filter((c) => c.threadId === t.id)
            .map((c) => ({
              id: c.id,
              body: c.body,
              author: c.authorId ? { id: c.authorId, name: c.authorName ?? 'Unknown' } : null,
              createdAt: c.createdAt.toISOString(),
              editedAt: c.editedAt?.toISOString() ?? null,
              canEdit: c.authorId === user.id,
              canDelete: c.authorId === user.id || manages,
            })),
        }),
      ),
    };
  }

  /** Start a discussion. A review answer passes notify/record false: its own email and activity entry already cover it. */
  async createThread(user: AuthUser, documentId: string, input: NewThread, opts: { notify?: boolean; record?: boolean } = {}) {
    const page = await this.page(user, documentId, 'comment');
    const body = this.cleanBody(input.body);
    const anchored = !!(input.anchorFrom && input.anchorTo);
    const id = await this.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(commentThreads)
        .values({
          documentId,
          anchorFrom: anchored ? input.anchorFrom! : null,
          anchorTo: anchored ? input.anchorTo! : null,
          quote: anchored ? input.quote?.trim().slice(0, 500) || null : null,
          createdById: user.id,
        })
        .returning({ id: commentThreads.id });
      await tx.insert(comments).values({ threadId: t.id, authorId: user.id, body });
      return t.id;
    });
    if (opts.record !== false) this.record(user, page, 'comment.added', { excerpt: body.slice(0, 200) });
    if (opts.notify !== false) this.notifications.commented({ threadId: id, documentId, authorId: user.id, body, reply: false });
    return id;
  }

  async reply(user: AuthUser, threadId: string, rawBody: string) {
    const thread = await this.thread(threadId);
    const page = await this.page(user, thread.documentId, 'comment');
    const body = this.cleanBody(rawBody);
    await this.db.insert(comments).values({ threadId, authorId: user.id, body });
    // Replying to a resolved discussion reopens it — someone has more to say.
    await this.db.update(commentThreads).set({ resolvedAt: null, resolvedById: null }).where(eq(commentThreads.id, threadId));
    this.record(user, page, 'comment.added', { excerpt: body.slice(0, 200), reply: true });
    this.notifications.commented({ threadId, documentId: thread.documentId, authorId: user.id, body, reply: true });
  }

  async setResolved(user: AuthUser, threadId: string, resolved: boolean) {
    const thread = await this.thread(threadId);
    const page = await this.page(user, thread.documentId, 'comment');
    if (!!thread.resolvedAt === resolved) return;
    await this.db
      .update(commentThreads)
      .set(resolved ? { resolvedAt: new Date(), resolvedById: user.id } : { resolvedAt: null, resolvedById: null })
      .where(eq(commentThreads.id, threadId));
    if (resolved) this.record(user, page, 'comment.resolved', thread.quote ? { quote: thread.quote.slice(0, 200) } : {});
  }

  async edit(user: AuthUser, commentId: string, rawBody: string) {
    const [c] = await this.db.select().from(comments).where(eq(comments.id, commentId));
    if (!c) throw new NotFoundException();
    const thread = await this.thread(c.threadId);
    await this.page(user, thread.documentId, 'comment');
    if (c.authorId !== user.id) throw new ForbiddenException('You can only edit your own comments.');
    await this.db.update(comments).set({ body: this.cleanBody(rawBody), editedAt: new Date() }).where(eq(comments.id, commentId));
  }

  /** Delete a comment; the last one in a thread takes the thread with it. */
  async remove(user: AuthUser, commentId: string) {
    const [c] = await this.db.select().from(comments).where(eq(comments.id, commentId));
    if (!c) throw new NotFoundException();
    const thread = await this.thread(c.threadId);
    const page = await this.page(user, thread.documentId, 'view');
    if (c.authorId !== user.id && !atLeast(page.level, 'manage')) throw new ForbiddenException('You can only delete your own comments.');
    await this.db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.id, commentId));
      const left = await tx.select({ id: comments.id }).from(comments).where(eq(comments.threadId, c.threadId)).limit(1);
      if (!left.length) await tx.delete(commentThreads).where(eq(commentThreads.id, c.threadId));
    });
  }

  private record(user: AuthUser, page: { id: string; title: string; spaceId: string }, action: 'comment.added' | 'comment.resolved', details: Record<string, unknown>) {
    this.activity.record({ action, actorId: user.id, spaceId: page.spaceId, target: { type: 'page', id: page.id, name: page.title }, details });
  }
}
