import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type PermissionLevel, type SystemRole } from '@trigon/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { displayStatus } from '../documents/documents.controller';
import { documents, groupMembers, groups, spaces, users } from '../db/schema';
import { EmailService, type OutgoingEmail } from '../email/email.service';
import { SettingsService } from '../settings/settings.service';

/** A whole group gets at most this many emails for one share; bigger groups are skipped (and logged). */
const MAX_SHARE_RECIPIENTS = 300;

const LEVEL_TEXT: Record<PermissionLevel, string> = {
  view: 'view',
  comment: 'view and comment on',
  edit: 'edit',
  manage: 'manage',
};

export const prefsOf = (stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs => ({ ...DEFAULT_NOTIFICATION_PREFS, ...(stored ?? {}) });

export type AccountChange =
  | { kind: 'created'; role: SystemRole }
  | { kind: 'role'; from: SystemRole; to: SystemRole }
  | { kind: 'deactivated' }
  | { kind: 'reactivated' }
  | { kind: 'password' };

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
      /** Short name for the subject line, long one (with the space) for the body. */
      let name: string;
      let what: string;
      let url: string;
      if (input.resourceType === 'space') {
        const [s] = await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, input.resourceId));
        if (!s) return;
        name = `the space “${s.name}”`;
        what = name;
        url = `${base}/spaces/${input.resourceId}`;
      } else {
        const [d] = await this.db
          .select({ title: documents.title, kind: documents.kind, space: spaces.name })
          .from(documents)
          .innerJoin(spaces, eq(spaces.id, documents.spaceId))
          .where(eq(documents.id, input.resourceId));
        if (!d) return;
        name = `the ${d.kind} “${d.title}”`;
        what = `${name} in ${d.space}`;
        url = `${base}/d/${input.resourceId}`;
      }
      const actor = await this.displayName(input.actorId);
      const changed = !!input.previousLevel;
      const subject = changed ? `Your access to ${name} changed` : `${actor} shared ${name} with you`;
      const text = [
        changed
          ? `${actor} changed your access to ${what}: you can now ${LEVEL_TEXT[input.level]} it (before: ${LEVEL_TEXT[input.previousLevel!]}).`
          : `${actor} shared ${what} with you. You can ${LEVEL_TEXT[input.level]} it.`,
        via ? `You have this access because you are a member of “${via}”.` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      await this.sendTo(recipientIds, 'shares', () => ({ subject, text, action: { label: 'Open in Trigon', url } }));
    });
  }

  /** Something about the person's own account changed. */
  account(userId: string, actorId: string, change: AccountChange) {
    this.run('Account', async () => {
      if (!(await this.email.enabled())) return;
      const base = await this.settings.publicUrl();
      const actor = await this.displayName(actorId);
      const msg: Pick<OutgoingEmail, 'subject' | 'text'> = (() => {
        switch (change.kind) {
          case 'created':
            return {
              subject: 'Your Trigon account is ready',
              text: `${actor} created a Trigon account for you (role: ${change.role}).\n\nSign in with this email address. Your administrator gives you the password separately — Trigon never sends passwords by email.`,
            };
          case 'role':
            return { subject: 'Your Trigon role changed', text: `${actor} changed your role from ${change.from} to ${change.to}.` };
          case 'deactivated':
            return { subject: 'Your Trigon account was deactivated', text: `${actor} deactivated your Trigon account. You have been signed out and can't sign in until it is reactivated.` };
          case 'reactivated':
            return { subject: 'Your Trigon account was reactivated', text: `${actor} reactivated your Trigon account. You can sign in again.` };
          case 'password':
            return {
              subject: 'Your Trigon password was changed',
              text: `${actor} set a new password for your Trigon account and signed you out everywhere.\n\nIf you didn't expect this, contact your administrator.`,
            };
        }
      })();
      // Security-relevant: a deactivated person still hears about it.
      await this.sendTo([userId], 'account', () => ({ ...msg, action: { label: 'Open Trigon', url: base } }), change.kind === 'deactivated');
    });
  }

  /** Every morning (07:00 UTC): pages people own that need review or are drafts. Weekly = Mondays. */
  @Cron('0 7 * * *')
  async reviewDigests(now = new Date()) {
    if (!(await this.email.enabled())) return;
    const owner = sql<string>`coalesce(${documents.ownerId}, ${documents.createdById})`;
    const rows = await this.db
      .select({ owner, id: documents.id, title: documents.title, status: displayStatus, space: spaces.name })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(and(isNull(documents.deletedAt), eq(documents.kind, 'page'), sql`${displayStatus} in ('stale', 'draft')`, sql`${owner} is not null`))
      .orderBy(documents.title);
    const byOwner = new Map<string, typeof rows>();
    for (const r of rows) byOwner.set(r.owner, [...(byOwner.get(r.owner) ?? []), r]);
    if (!byOwner.size) return;

    const base = await this.settings.publicUrl();
    const due = (p: NotificationPrefs) => p.reviewDigest === 'daily' || (p.reviewDigest === 'weekly' && weeklyDue(now));
    const people = await this.db
      .select({ id: users.id, email: users.email, prefs: users.notificationPrefs })
      .from(users)
      .where(and(inArray(users.id, [...byOwner.keys()]), eq(users.active, true)));
    for (const person of people) {
      if (!person.email || !due(prefsOf(person.prefs))) continue;
      const pages = byOwner.get(person.id)!;
      const stale = pages.filter((p) => p.status === 'stale');
      const drafts = pages.filter((p) => p.status === 'draft');
      const list = (ps: typeof pages) =>
        ps
          .slice(0, 25)
          .map((p) => `• ${p.title} (${p.space})\n  ${base}/d/${p.id}`)
          .join('\n') + (ps.length > 25 ? `\n…and ${ps.length - 25} more` : '');
      const text = [
        `You own ${pages.length} page${pages.length === 1 ? '' : 's'} that need${pages.length === 1 ? 's' : ''} attention.`,
        stale.length ? `Needs review — verified too long ago:\n${list(stale)}` : '',
        drafts.length ? `Drafts waiting to be verified:\n${list(drafts)}` : '',
        'You can change how often you get this email in Trigon under Profile → Notifications.',
      ]
        .filter(Boolean)
        .join('\n\n');
      this.email.notify({
        to: person.email,
        subject: `${pages.length} page${pages.length === 1 ? '' : 's'} to review in Trigon`,
        text,
        action: { label: 'Open the review list', url: `${base}/review` },
      });
    }
  }

  /** Email each recipient who wants this kind of message. */
  private async sendTo(userIds: string[], kind: 'shares' | 'account', build: () => Omit<OutgoingEmail, 'to'>, includeInactive = false) {
    const people = await this.db
      .select({ email: users.email, prefs: users.notificationPrefs })
      .from(users)
      .where(and(inArray(users.id, userIds), includeInactive ? undefined : eq(users.active, true)));
    const mail = build();
    for (const p of people) {
      if (p.email && prefsOf(p.prefs)[kind]) this.email.notify({ ...mail, to: p.email });
    }
  }
}
