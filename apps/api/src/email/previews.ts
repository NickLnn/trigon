import { accountEmail, digestEmail, shareEmail, testEmail } from '../notifications/messages';
import { LOGO_PNG_BASE64 } from './logo';
import { renderEmailHtml, type EmailContent } from './template';

/** Sample of every email Trigon sends, for Settings → Email → Preview. Only made-up data. */
export const EMAIL_PREVIEWS: Record<string, { label: string; build: (base: string) => EmailContent }> = {
  share: {
    label: 'Shared with you',
    build: (base) =>
      shareEmail({
        base,
        actor: { name: 'Maria Papadopoulou', email: 'maria@example.com' },
        item: { kind: 'page', id: '00000000-0000-0000-0000-000000000001', title: 'Reset a user’s MFA in Entra ID', space: 'Microsoft 365' },
        level: 'edit',
        previousLevel: null,
        group: null,
      }),
  },
  'share-group': {
    label: 'Shared with your group',
    build: (base) =>
      shareEmail({
        base,
        actor: { name: 'Maria Papadopoulou', email: 'maria@example.com' },
        item: { kind: 'space', id: '00000000-0000-0000-0000-000000000002', title: 'Networking', space: null },
        level: 'view',
        previousLevel: null,
        group: 'Helpdesk',
      }),
  },
  'share-changed': {
    label: 'Access changed',
    build: (base) =>
      shareEmail({
        base,
        actor: { name: 'Maria Papadopoulou', email: 'maria@example.com' },
        item: { kind: 'folder', id: '00000000-0000-0000-0000-000000000003', title: 'Firewall runbooks', space: 'Networking' },
        level: 'manage',
        previousLevel: 'edit',
        group: null,
      }),
  },
  created: {
    label: 'Account created',
    build: (base) => accountEmail({ base, actor: 'Maria Papadopoulou', name: 'George Ioannou', change: { kind: 'created', role: 'editor', email: 'george@example.com' }, at: new Date() }),
  },
  role: {
    label: 'Role changed',
    build: (base) => accountEmail({ base, actor: 'Maria Papadopoulou', name: 'George Ioannou', change: { kind: 'role', from: 'editor', to: 'admin' }, at: new Date() }),
  },
  password: {
    label: 'Password changed',
    build: (base) => accountEmail({ base, actor: 'Maria Papadopoulou', name: 'George Ioannou', change: { kind: 'password' }, at: new Date() }),
  },
  deactivated: {
    label: 'Account deactivated',
    build: (base) => accountEmail({ base, actor: 'Maria Papadopoulou', name: 'George Ioannou', change: { kind: 'deactivated' }, at: new Date() }),
  },
  digest: {
    label: 'Pages to review',
    build: (base) => {
      const now = new Date();
      const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
      return digestEmail({
        base,
        name: 'George Ioannou',
        now,
        frequency: 'weekly',
        pages: [
          { id: '00000000-0000-0000-0000-000000000011', title: 'VPN client setup (Windows)', space: 'Networking', status: 'stale', since: days(212) },
          { id: '00000000-0000-0000-0000-000000000012', title: 'Onboarding checklist', space: 'HR & IT', status: 'stale', since: days(190) },
          { id: '00000000-0000-0000-0000-000000000013', title: 'Backup restore procedure', space: 'Servers', status: 'draft', since: days(3) },
        ],
      });
    },
  },
  test: {
    label: 'Test email',
    build: (base) => testEmail({ base, method: 'Microsoft 365 / Exchange Online', to: 'you@example.com' }),
  },
};

export function previewHtml(kind: string, base: string): string | null {
  const preview = EMAIL_PREVIEWS[kind];
  return preview ? renderEmailHtml(preview.build(base), { appUrl: base, logoSrc: `data:image/png;base64,${LOGO_PNG_BASE64}` }) : null;
}
