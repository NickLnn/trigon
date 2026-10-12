import type { PermissionLevel, SystemRole } from '@trigon/shared';
import type { EmailContent } from '../email/template';

/** Wording of every notification email. Pure functions: the service fills them with real data, previews with samples. */

export const ACCESS_TEXT: Record<PermissionLevel, string> = {
  view: 'Can view',
  comment: 'Can view and comment',
  edit: 'Can edit',
  manage: 'Can manage (edit and share)',
};

const ROLE_TEXT: Record<SystemRole, string> = {
  admin: 'Administrator',
  editor: 'Editor',
  viewer: 'Viewer',
};

const when = (d: Date) =>
  `${d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;

export interface ShareInput {
  base: string;
  actor: { name: string; email: string | null };
  item: { kind: 'space' | 'page' | 'folder' | 'file'; id: string; title: string; space: string | null };
  level: PermissionLevel;
  previousLevel: PermissionLevel | null;
  /** Group the access came through, if any. */
  group: string | null;
}

export function shareEmail(i: ShareInput): EmailContent {
  const kind = i.item.kind;
  const url = kind === 'space' ? `${i.base}/spaces/${i.item.id}` : `${i.base}/d/${i.item.id}`;
  const changed = !!i.previousLevel;
  const details = [
    { label: kind === 'space' ? 'Space' : kind[0].toUpperCase() + kind.slice(1), value: i.item.title },
    ...(i.item.space && kind !== 'space' ? [{ label: 'Space', value: i.item.space }] : []),
    { label: changed ? 'Access now' : 'Your access', value: ACCESS_TEXT[i.level] },
    ...(changed ? [{ label: 'Access before', value: ACCESS_TEXT[i.previousLevel!] }] : []),
    { label: changed ? 'Changed by' : 'Shared by', value: i.actor.email ? `${i.actor.name} (${i.actor.email})` : i.actor.name },
    ...(i.group ? [{ label: 'Through group', value: i.group }] : []),
  ];
  return {
    subject: changed ? `Your access to “${i.item.title}” changed` : `${i.actor.name} shared “${i.item.title}” with you`,
    heading: changed ? `Your access to a ${kind} changed` : `${i.actor.name} shared a ${kind} with you`,
    intro: changed
      ? `${i.actor.name} changed what you can do with “${i.item.title}”.`
      : `${i.actor.name} gave ${i.group ? `the “${i.group}” group` : 'you'} access to “${i.item.title}” in Trigon.`,
    details,
    action: { label: `Open ${kind}`, url },
    note: i.group ? `You have this access because you are a member of “${i.group}”.` : undefined,
    reason: 'You received this because “Shared with me” emails are on.',
  };
}

export type AccountChange =
  | { kind: 'created'; role: SystemRole; email: string }
  | { kind: 'role'; from: SystemRole; to: SystemRole }
  | { kind: 'deactivated' }
  | { kind: 'reactivated' }
  | { kind: 'password' };

export function accountEmail(i: { base: string; actor: string; name: string; change: AccountChange; at: Date }): EmailContent {
  const by = { label: 'By', value: i.actor };
  const at = { label: 'When', value: when(i.at) };
  const reason = 'You received this because “Account changes” emails are on.';
  const open = { label: 'Open Trigon', url: i.base };
  switch (i.change.kind) {
    case 'created':
      return {
        subject: 'Your Trigon account is ready',
        heading: `Welcome to Trigon, ${i.name.split(' ')[0]}`,
        intro: `${i.actor} created a Trigon account for you. Trigon is your team’s knowledge base: runbooks, how-tos and documentation in one place.`,
        details: [
          { label: 'Sign-in email', value: i.change.email },
          { label: 'Role', value: ROLE_TEXT[i.change.role] },
          { label: 'Created by', value: i.actor },
        ],
        action: { label: 'Sign in to Trigon', url: `${i.base}/login` },
        note: 'Your administrator gives you your password separately. Trigon never sends passwords by email.',
        reason,
      };
    case 'role':
      return {
        subject: 'Your Trigon role changed',
        heading: 'Your role changed',
        intro: `${i.actor} changed your role in Trigon.`,
        details: [{ label: 'Role now', value: ROLE_TEXT[i.change.to] }, { label: 'Role before', value: ROLE_TEXT[i.change.from] }, by, at],
        action: open,
        reason,
      };
    case 'deactivated':
      return {
        subject: 'Your Trigon account was deactivated',
        heading: 'Your account was deactivated',
        intro: `${i.actor} deactivated your Trigon account. You have been signed out on every device and can’t sign in until it is reactivated.`,
        details: [by, at],
        note: 'If you think this is a mistake, contact your administrator.',
        reason,
      };
    case 'reactivated':
      return {
        subject: 'Your Trigon account was reactivated',
        heading: 'Welcome back',
        intro: `${i.actor} reactivated your Trigon account. You can sign in again.`,
        details: [by, at],
        action: { label: 'Sign in to Trigon', url: `${i.base}/login` },
        reason,
      };
    case 'password':
      return {
        subject: 'Your Trigon password was changed',
        heading: 'Your password was changed',
        intro: `${i.actor} set a new password for your Trigon account. For your security you have been signed out on every device.`,
        details: [by, at],
        action: { label: 'Sign in to Trigon', url: `${i.base}/login` },
        note: 'If you didn’t expect this, contact your administrator right away.',
        reason,
      };
  }
}

export interface DigestPage {
  id: string;
  title: string;
  space: string;
  status: 'stale' | 'draft';
  /** verifiedAt for stale pages, updatedAt for drafts. */
  since: Date;
}

const ago = (d: Date, now: Date) => {
  const days = Math.max(0, Math.round((now.getTime() - d.getTime()) / 86_400_000));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365)} years ago`;
};

const LIST_MAX = 15;

export function digestEmail(i: { base: string; name: string; pages: DigestPage[]; now: Date; frequency: 'daily' | 'weekly' }): EmailContent {
  const stale = i.pages.filter((p) => p.status === 'stale');
  const drafts = i.pages.filter((p) => p.status === 'draft');
  const n = i.pages.length;
  const section = (title: string, ps: DigestPage[], verb: string) => ({
    title,
    items: ps.slice(0, LIST_MAX).map((p) => ({ title: p.title, meta: `${p.space} · ${verb} ${ago(p.since, i.now)}`, url: `${i.base}/d/${p.id}` })),
    more: Math.max(0, ps.length - LIST_MAX),
  });
  return {
    subject: `${n} page${n === 1 ? '' : 's'} to review in Trigon`,
    heading: `${n} page${n === 1 ? ' needs' : 's need'} your attention`,
    intro: `Hi ${i.name.split(' ')[0]}, you own ${n === 1 ? 'a page that is' : `${n} pages that are`} out of date or still in draft. Reviewing them keeps the knowledge base trustworthy for everyone.`,
    details: [
      { label: 'Needs review', value: `${stale.length} page${stale.length === 1 ? '' : 's'}` },
      { label: 'Drafts', value: `${drafts.length} page${drafts.length === 1 ? '' : 's'}` },
    ],
    sections: [
      ...(stale.length ? [section('Needs review', stale, 'verified')] : []),
      ...(drafts.length ? [section('Drafts waiting to be verified', drafts, 'edited')] : []),
    ],
    action: { label: 'Open the review list', url: `${i.base}/review` },
    reason: `You received this ${i.frequency} summary because “Pages to review” emails are on.`,
  };
}

export interface ReviewItem {
  id: string;
  title: string;
  kind: 'page' | 'folder' | 'file';
  space: string;
}

export function reviewRequestEmail(i: { base: string; requester: { name: string; email: string | null }; item: ReviewItem; message: string | null }): EmailContent {
  return {
    subject: `${i.requester.name} asked you to review “${i.item.title}”`,
    heading: `Review requested: ${i.item.title}`,
    intro: `${i.requester.name} would like you to check this ${i.item.kind} and confirm it is correct. Open it in Trigon, then choose Approve or Request changes.`,
    details: [
      { label: i.item.kind[0].toUpperCase() + i.item.kind.slice(1), value: i.item.title },
      { label: 'Space', value: i.item.space },
      { label: 'Requested by', value: i.requester.email ? `${i.requester.name} (${i.requester.email})` : i.requester.name },
      ...(i.message ? [{ label: 'Message', value: i.message }] : []),
    ],
    action: { label: `Review ${i.item.kind}`, url: `${i.base}/d/${i.item.id}` },
    note: 'It also waits for you on your Trigon home page under “Waiting for your review”.',
    reason: 'You received this because “Review requests” emails are on.',
  };
}

export function reviewAnsweredEmail(i: { base: string; reviewer: string; item: ReviewItem; approved: boolean; note: string | null }): EmailContent {
  return {
    subject: i.approved ? `${i.reviewer} approved “${i.item.title}”` : `${i.reviewer} asked for changes to “${i.item.title}”`,
    heading: i.approved ? 'Your review request was approved' : 'Changes requested',
    intro: i.approved
      ? `${i.reviewer} reviewed “${i.item.title}” and approved it. It is now marked as verified.`
      : `${i.reviewer} reviewed “${i.item.title}” and asked for changes before approving it. It is now marked as a draft.`,
    details: [
      { label: i.item.kind[0].toUpperCase() + i.item.kind.slice(1), value: i.item.title },
      { label: 'Space', value: i.item.space },
      { label: 'Reviewed by', value: i.reviewer },
      { label: 'Result', value: i.approved ? 'Approved' : 'Changes requested' },
      ...(i.note ? [{ label: i.approved ? 'Comment' : 'Requested changes', value: i.note }] : []),
    ],
    action: { label: `Open ${i.item.kind}`, url: `${i.base}/d/${i.item.id}` },
    reason: 'You received this because “Review requests” emails are on.',
  };
}

export function testEmail(i: { base: string; method: string; to: string }): EmailContent {
  return {
    subject: 'Trigon test email',
    heading: 'Email is working',
    intro: 'This is a test message from Trigon. If you can read it, notification emails will reach your team.',
    details: [
      { label: 'Sent with', value: i.method },
      { label: 'Sent to', value: i.to },
    ],
    action: { label: 'Open Trigon', url: i.base },
  };
}
