import { Injectable, Logger } from '@nestjs/common';
import type { AuthProvider, SessionUser } from '@trigon/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { accounts, users, type User } from '../db/schema';

export interface ExternalIdentity {
  provider: AuthProvider;
  providerAccountId: string;
  email: string;
  displayName: string;
  jobTitle?: string | null;
  department?: string | null;
  active?: boolean;
  profile?: Record<string, unknown>;
}

/**
 * Maps local, LDAP and Entra identities onto one User.
 *
 * Linking rule: an Account is matched by (provider, providerAccountId). If none exists, the
 * identity is linked to the existing User with the same e-mail (case-insensitive), otherwise a
 * new User is created. Only directory-verified providers (Entra, LDAP) auto-link by e-mail;
 * a local sign-up never attaches itself to an existing directory user.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async findUserByEmail(email: string): Promise<User | undefined> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return u;
  }

  async findAccount(provider: AuthProvider, providerAccountId: string) {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)))
      .limit(1);
    return row;
  }

  /** Upsert user + account from a directory source. Used by both SSO login and background sync. */
  async upsertExternal(identity: ExternalIdentity): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [existingAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)))
        .limit(1);

      const profileFields = {
        displayName: identity.displayName,
        ...(identity.jobTitle !== undefined && { jobTitle: identity.jobTitle }),
        ...(identity.department !== undefined && { department: identity.department }),
        ...(identity.active !== undefined && { active: identity.active }),
      };

      let user: User | undefined;
      if (existingAccount) {
        [user] = await tx.update(users).set(profileFields).where(eq(users.id, existingAccount.userId)).returning();
        await tx
          .update(accounts)
          .set({ profile: identity.profile, lastSyncedAt: new Date() })
          .where(eq(accounts.id, existingAccount.id));
        return user!;
      }

      [user] = await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${identity.email.toLowerCase()}`)
        .limit(1);

      if (user) {
        [user] = await tx.update(users).set(profileFields).where(eq(users.id, user.id)).returning();
        this.logger.log(`Linked ${identity.provider} identity to existing user ${user.email}`);
      } else {
        const [{ total }] = await tx.select({ total: count() }).from(users);
        [user] = await tx
          .insert(users)
          .values({ email: identity.email, role: total === 0 ? 'admin' : 'member', ...profileFields })
          .returning();
      }

      await tx.insert(accounts).values({
        userId: user.id,
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
        profile: identity.profile,
        lastSyncedAt: new Date(),
      });
      return user;
    });
  }

  /** Create a local email/password user. The first user of a fresh install becomes admin. */
  async createLocal(email: string, displayName: string, passwordHash: string): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [{ total }] = await tx.select({ total: count() }).from(users);
      const [user] = await tx
        .insert(users)
        .values({ email, displayName, role: total === 0 ? 'admin' : 'member' })
        .returning();
      await tx.insert(accounts).values({
        userId: user.id,
        provider: 'local',
        providerAccountId: email.toLowerCase(),
        passwordHash,
      });
      return user;
    });
  }

  async touchLogin(userId: string) {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }

  async toSessionUser(userId: string): Promise<SessionUser | null> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      with: { accounts: { columns: { provider: true } } },
    });
    if (!user || !user.active) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      providers: [...new Set(user.accounts.map((a) => a.provider))],
    };
  }
}
