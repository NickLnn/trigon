import { Injectable } from '@nestjs/common';
import type { SystemRole } from '@trigon/shared';
import { eq } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { users } from '../db/schema';

export interface UserStatus {
  active: boolean;
  role: SystemRole;
}

/** How long a looked-up status is reused. Deactivation and role changes apply within this time at most. */
export const STATUS_TTL_MS = 10_000;

/**
 * The current role and active flag of a user, from the database (briefly cached). Access tokens carry a
 * role, but a token issued before an admin demoted or deactivated someone must not keep working until it
 * expires: every request and every live-editing message is checked against this instead.
 */
@Injectable()
export class UserStatusService {
  private readonly cache = new Map<string, { at: number; status: UserStatus | null }>();
  /** Clock and loader; replaced in tests. */
  now: () => number = Date.now;
  load: (userId: string) => Promise<UserStatus | null> = async (userId) => {
    const [row] = await this.db.select({ active: users.active, role: users.role }).from(users).where(eq(users.id, userId));
    return row ?? null;
  };

  constructor(@InjectDb() private readonly db: Database) {}

  async get(userId: string): Promise<UserStatus | null> {
    const hit = this.cache.get(userId);
    if (hit && this.now() - hit.at < STATUS_TTL_MS) return hit.status;
    const status = await this.load(userId);
    this.cache.set(userId, { at: this.now(), status });
    if (this.cache.size > 10_000) {
      for (const [k, v] of this.cache) if (this.now() - v.at >= STATUS_TTL_MS) this.cache.delete(k);
    }
    return status;
  }

  /** Forget a user's cached status (call after changing their role or active flag). */
  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
