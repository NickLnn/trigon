import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type PermissionLevel } from '@trigon/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { displayStatus } from '../documents/documents.controller';
import { documents, groupMembers, groups, spaces, users } from '../db/schema';
import { EmailService } from '../email/email.service';
import type { EmailContent } from '../email/template';
import { SettingsService } from '../settings/settings.service';
import { accountEmail, digestEmail, shareEmail, type AccountChange, type DigestPage } from './messages';

/** A whole group gets at most this many emails for one share; bigger groups are skipped (and logged). */
const MAX_SHARE_RECIPIENTS = 300;

export const prefsOf = (stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs => ({ ...DEFAULT_NOTIFICATION_PREFS, ...(stored ?? {}) });

export type { AccountChange };

/** Is a weekly digest due on this date (Mondays)? */
export const weeklyDue = (d: Date) => d.getUTCDay() === 1;

/**
 * Email notifications: shares, account changes and the review digest. Every send checks the
 * recipient's choices (Profile → Notifications); nothing is sent while email is not set up.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
  ) {}

  private run(what: string, job: () => Promise<void>) {
    job().catch((err: Error) => this.logger.error(`${what} notification failed: ${err.message}`));
  }

  private async displayName(userId: string) {
    const [u] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
    return u?.name ?? 'Someone';
  }

  /** Access was granted or its level changed: tell the person, or every member of the group. */
  shared(input: {
    actorId: string;
    resourceType: 'space' | 'document';
    resourceId: string;
    subjectType: 'user' | 'group' | 'everyone';
    subjectId: string | null;
    level: PermissionLevel;
    previousLevel: PermissionLevel | null;
  }) {
    // "Everyone in Trigon" would email the whole organisation — not a notification anyone wants.
    if (input.subjectType === 'everyone' || !input.subjectId) return;
    this.run('Share', async () => {
      if (!(await this.email.enabled())) return;
      let recipientIds = [input.subjectId!];
      let via: string | null = null;
      if (input.subjectType === 'group') {
        const [g] = await this.db.select({ name: groups.name }).from(groups).where(eq(groups.id, input.subjectId!));
        via = g?.name ?? 'a group';
        recipientIds = (await this.db.select({ id: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, input.subjectId!))).map((m) => m.id);
        if (recipientIds.length > MAX_SHARE_RECIPIENTS) {
          this.logger.warn(`Not emailing ${recipientIds.length} members of "${via}" about a share (limit ${MAX_SHARE_RECIPIENTS}).`);
          return;
        }
      }
      recipientIds = recipientIds.filter((id) => id !== input.actorId);
      if (!recipientIds.length) return;

      const base = await this.settings.publicUrl();
      let item: Parameters<typeof shareEmail>[0]['item'];
      if (input.resourceType === 'space') {
        const [sp] = await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, input.resourceId));
        if (!sp) return;
        item = { kind: 'space', id: input.resourceId, title: sp.name, space: null };
      } else {
        const [d] = await this.db
          .select({ title: documents.title, kind: documents.kind, space: spaces.name })
          .from(documents)
          .innerJoin(spaces, eq(spaces.id, documents.spaceId))
          .where(eq(documents.id, input.resourceId));
        if (!d) return;
        item = { kind: d.kind, id: input.resourceId, title: d.title, space: d.space };
      }
      const [actor] = await this.db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, input.actorId));
      const content = shareEmail({
        base,
        actor: { name: actor?.name ?? 'Someone', email: actor?.email ?? null },
        item,
        level: input.level,
        previousLevel: input.previousLevel,
        group: via,
      });
      await this.sendTo(recipientIds, 'shares', content);
    });
  }

  /** Something about the person's own account changed. */
  account(userId: string, actorId: string, change: AccountChange) {
    this.run('Account', async () => {
      if (!(await this.email.enabled())) return;
      const base = await this.settings.publicUrl();
      const [person] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
      const content = accountEmail({ base, actor: await this.displayName(actorId), name: person?.name ?? '', change, at: new Date() });
      // Security-relevant: a deactivated person still hears about it.
      await this.sendTo([userId], 'account', content, change.kind === 'deactivated');
    });
  }

  /** Every morning (07:00 UTC): pages people own that need review or are drafts. Weekly = Mondays. */
  @Cron('0 7 * * *')
  async reviewDigests(now = new Date()) {
    if (!(await this.email.enabled())) return;
    const owner = sql<string>`coalesce(${documents.ownerId}, ${documents.createdById})`;
    const rows = await this.db
      .select({
        owner,
        id: documents.id,
        title: documents.title,
        status: displayStatus,
        space: spaces.name,
        since: sql<string>`case when ${documents.status} = 'verified' then ${documents.verifiedAt} else ${documents.updatedAt} end`,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(and(isNull(documents.deletedAt), eq(documents.kind, 'page'), sql`${displayStatus} in ('stale', 'draft')`, sql`${owner} is not null`))
      .orderBy(sql`case when ${documents.status} = 'verified' then ${documents.verifiedAt} else ${documents.updatedAt} end`);
    const byOwner = new Map<string, DigestPage[]>();
    for (const r of rows) {
      const page: DigestPage = { id: r.id, title: r.title, space: r.space, status: r.status as DigestPage['status'], since: new Date(r.since) };
      byOwner.set(r.owner, [...(byOwner.get(r.owner) ?? []), page]);
    }
    if (!byOwner.size) return;

    const base = await this.settings.publicUrl();
    const people = await this.db
      .select({ id: users.id, name: users.displayName, email: users.email, prefs: users.notificationPrefs })
      .from(users)
      .where(and(inArray(users.id, [...byOwner.keys()]), eq(users.active, true)));
    for (const person of people) {
      const { reviewDigest } = prefsOf(person.prefs);
      const due = reviewDigest === 'daily' || (reviewDigest === 'weekly' && weeklyDue(now));
      if (!person.email || !due) continue;
      const content = digestEmail({ base, name: person.name, pages: byOwner.get(person.id)!, now, frequency: reviewDigest as 'daily' | 'weekly' });
      this.email.notify({ ...content, to: person.email });
    }
  }

  /** Email each recipient who wants this kind of message. */
  private async sendTo(userIds: string[], kind: 'shares' | 'account', content: EmailContent, includeInactive = false) {
    const people = await this.db
      .select({ email: users.email, prefs: users.notificationPrefs })
      .from(users)
      .where(and(inArray(users.id, userIds), includeInactive ? undefined : eq(users.active, true)));
    for (const p of people) {
      if (p.email && prefsOf(p.prefs)[kind]) this.email.notify({ ...content, to: p.email });
    }
  }
}
