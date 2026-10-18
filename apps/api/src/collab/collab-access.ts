import { atLeast, type PermissionLevel } from '@trigon/shared';
import type { UserStatus } from '../auth/user-status.service';

export type CollabAccess = 'none' | 'read' | 'write';

/** How often a live connection's access is looked up again (on its next message, and by the sweep). */
export const COLLAB_RECHECK_MS = 15_000;

/** What a live-editing connection may do: nothing (disconnect), read only, or edit. */
export function collabAccess(status: UserStatus | null, level: PermissionLevel | null): CollabAccess {
  if (!status?.active) return 'none';
  if (!atLeast(level, 'view')) return 'none';
  return atLeast(level, 'edit') ? 'write' : 'read';
}

/** Connection context kept from sign-in; `checkedAt` is when access was last confirmed. */
export interface CollabContext {
  userId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  checkedAt: number;
  restoreNote?: string;
}

/** Error that makes Hocuspocus close the connection with a permission-denied reason. */
export const accessRevoked = (documentName: string) =>
  Object.assign(new Error(`access to ${documentName} was revoked`), { code: 4403, reason: 'permission-denied' });
