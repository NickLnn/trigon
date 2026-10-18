import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ACTIVITY_ACTIONS, type ActivityAction } from '@trigon/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { activity, documents, groups, spaces, users } from '../db/schema';
import { redact } from './redact';
import { requestContext, type RequestContext } from './request-context';
import { textDiff } from './text-diff';

export interface ActivityTarget {
  type: string;
  id: string | null;
  name: string | null;
}

export interface ActivityInput {
  action: ActivityAction;
  /** Who did it; null for an anonymous attempt (e.g. a failed sign-in with an unknown e-mail). */
  actorId: string | null;
  /** Shown when there is no actor row (failed sign-ins). */
  actorName?: string | null;
  spaceId?: string | null;
  target?: ActivityTarget;
  details?: Record<string, unknown>;
  /** Where the action came from when it didn't arrive as an HTTP request (live editing). */
  client?: RequestContext;
}

export interface EditInput {
  /** Plain text of the page or file before and after this save. */
  before: string;
  after: string;
  client?: RequestContext;
}

/** Continuous typing in a page becomes one "Edited page" entry per person per session. */
const EDIT_SESSION_MS = 30 * 60_000;

const DEFAULT_RETENTION_DAYS = 365;

/**
 * Writes the audit log. Recording never fails the action being recorded: errors are logged and
 * swallowed, and callers don't await it.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  /** `${actorId}:${documentId}` → the open "Edited page" row, the text it started from, and when it was last extended. */
  private readonly editSessions = new Map<string, { id: string; last: number; baseline: string }>();

  constructor(@InjectDb() private readonly db: Database) {}

  record(input: ActivityInput): void {
    this.write(input).catch((err: Error) => this.logger.error(`Recording ${input.action} failed: ${err.message}`));
  }

  private async write(input: ActivityInput): Promise<string> {
    const ctx = input.client ?? requestContext();
    const [actor] = input.actorId
      ? await this.db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, input.actorId))
      : [];
    const [space] = input.spaceId ? await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, input.spaceId)) : [];
    const [row] = await this.db
      .insert(activity)
      .values({
        actorId: input.actorId,
        actorName: actor?.name ?? input.actorName ?? null,
        actorEmail: actor?.email ?? null,
        action: input.action,
        category: ACTIVITY_ACTIONS[input.action].category,
        spaceId: input.spaceId ?? null,
        spaceName: space?.name ?? (input.target?.type === 'space' ? input.target.name : null),
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        targetName: input.target?.name ?? null,
        // Belt and braces: no password, token or secret value is ever stored, whatever a caller passes.
        details: redact(input.details ?? {}) as Record<string, unknown>,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      })
      .returning({ id: activity.id });
    return row.id;
  }

  /**
   * A collaborative save of a page (or a text file save) by `actorId`. Saves are coalesced into editing
   * sessions; each session keeps a line diff from the text it started with to the latest save.
   */
  noteEdit(actorId: string | undefined, documentId: string, edit: EditInput, action: 'page.edited' | 'file.edited' = 'page.edited'): void {
    if (!actorId || edit.before === edit.after) return;
    this.extendEdit(actorId, documentId, edit, action).catch((err: Error) => this.logger.error(`Recording ${action} failed: ${err.message}`));
  }

  private async extendEdit(actorId: string, documentId: string, edit: EditInput, action: 'page.edited' | 'file.edited') {
    const key = `${actorId}:${documentId}`;
    const now = Date.now();
    const open = this.editSessions.get(key);
    if (open && now - open.last < EDIT_SESSION_MS) {
      open.last = now;
      const diff = textDiff(open.baseline, edit.after);
      await this.db
        .update(activity)
        .set({
          details: sql`${activity.details} || jsonb_build_object('saves', coalesce((${activity.details}->>'saves')::int, 1) + 1, 'until', now(), 'diff', ${JSON.stringify(diff)}::jsonb)`,
        })
        .where(eq(activity.id, open.id));
      return;
    }
    const [doc] = await this.db
      .select({ spaceId: documents.spaceId, title: documents.title, kind: documents.kind })
      .from(documents)
      .where(eq(documents.id, documentId));
    if (!doc) return;
    const id = await this.write({
      action,
      actorId,
      spaceId: doc.spaceId,
      target: { type: doc.kind, id: documentId, name: doc.title },
      details: { saves: 1, diff: textDiff(edit.before, edit.after) },
      client: edit.client,
    });
    this.editSessions.set(key, { id, last: now, baseline: edit.before });
    if (this.editSessions.size > 5000) {
      for (const [k, v] of this.editSessions) if (now - v.last >= EDIT_SESSION_MS) this.editSessions.delete(k);
    }
  }

  /** Readable name of a permission subject, for sharing entries. */
  async subjectName(subjectType: 'user' | 'group' | 'everyone', subjectId: string | null): Promise<string> {
    if (subjectType === 'everyone' || !subjectId) return 'Everyone in Trigon';
    if (subjectType === 'user') {
      const [u] = await this.db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, subjectId));
      return u ? `${u.name} (${u.email})` : 'Unknown user';
    }
    const [g] = await this.db.select({ name: groups.name }).from(groups).where(eq(groups.id, subjectId));
    return g ? g.name : 'Unknown group';
  }

  /** Keep the log bounded: ACTIVITY_RETENTION_DAYS (default 365; 0 keeps everything). */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune() {
    const days = Number(process.env.ACTIVITY_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
    if (!(days > 0)) return;
    await this.db.delete(activity).where(and(lt(activity.at, sql`now() - make_interval(days => ${days})`)));
  }
}
