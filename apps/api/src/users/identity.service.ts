import { Injectable, Logger } from '@nestjs/common';
import type { AuthProvider, SessionUser } from '@trigon/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { ActivityService } from '../activity/activity.service';
import { accounts, users, type User } from '../db/schema';

/** Admins and people with a local password can't be taken over by a directory e-mail match. */
export const isProtected = (user: Pick<User, 'role'>, hasLocalPassword: boolean) => user.role === 'admin' || hasLocalPassword;

/** What the directory says, except that it never re-enables an account an administrator disabled. */
export const effectiveActive = (directoryActive: boolean, current: Pick<User, 'disabledByAdmin'> | undefined) =>
  directoryActive && !current?.disabledByAdmin;

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

/** A directory identity would be attached to an account it isn't allowed to take over by e-mail alone. */
export class IdentityLinkRefused extends Error {
  constructor(readonly email: string) {
    super(
      `An account for ${email} already exists in Trigon. To use this sign-in method with it, sign in with your password first, then choose this sign-in method again — or ask an administrator.`,
    );
  }
}

export interface UpsertOptions {
  /**
   * The user signed in on this browser right now (valid session cookie). Proves control of that account,
   * so a protected account may be linked to the directory identity when it is this one.
   */
  linkUserId?: string | null;
}

/**
 * Maps local, LDAP and Entra identities onto one User.
 *
 * Linking rule: an Account is matched by (provider, providerAccountId). If none exists, the identity may
 * be linked to the existing User with the same e-mail (case-insensitive) — but a directory e-mail
 * attribute is not proof of ownership (it is often editable, and guest accounts carry unverified ones),
 * so *protected* users (admins, and anyone with a local password) are only linked when the person
 * proves control of that account by being signed in to it. Otherwise IdentityLinkRefused is thrown.
 * A local sign-up never attaches itself to an existing directory user.
 *
 * `active` from the directory never re-enables an account an administrator disabled (disabledByAdmin).
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly activity: ActivityService,
  ) {}

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
  async upsertExternal(identity: ExternalIdentity, opts: UpsertOptions = {}): Promise<User> {
    let linkedTo: User | null = null;
    const user = await this.db.transaction(async (tx) => {
      const [existingAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)))
        .limit(1);

      const profileFields = (current: User | undefined) => ({
        displayName: identity.displayName,
        ...(identity.jobTitle !== undefined && { jobTitle: identity.jobTitle }),
        ...(identity.department !== undefined && { department: identity.department }),
        ...(identity.active !== undefined && { active: effectiveActive(identity.active, current) }),
      });

      let user: User | undefined;
      if (existingAccount) {
        const [current] = await tx.select().from(users).where(eq(users.id, existingAccount.userId));
        [user] = await tx.update(users).set(profileFields(current)).where(eq(users.id, existingAccount.userId)).returning();
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
        const [local] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.userId, user.id), eq(accounts.provider, 'local')))
          .limit(1);
        if (isProtected(user, !!local) && user.id !== opts.linkUserId) throw new IdentityLinkRefused(user.email);
        [user] = await tx.update(users).set(profileFields(user)).where(eq(users.id, user.id)).returning();
        linkedTo = user;
        this.logger.log(`Linked ${identity.provider} identity to existing user ${user.email}`);
      } else {
        const [{ total }] = await tx.select({ total: count() }).from(users);
        [user] = await tx
          .insert(users)
          .values({ email: identity.email, role: total === 0 ? 'admin' : 'editor', ...profileFields(undefined) })
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
    if (linkedTo) {
      const target = linkedTo as User;
      this.activity.record({
        action: 'user.identity_linked',
        actorId: opts.linkUserId ?? null,
        actorName: opts.linkUserId ? null : `${identity.provider === 'entra' ? 'Microsoft' : 'LDAP'} sync`,
        target: { type: 'user', id: target.id, name: target.displayName },
        details: { provider: identity.provider, providerAccountId: identity.providerAccountId, email: identity.email },
      });
    }
    return user;
  }

  /** Create a local email/password user. The first user of a fresh install becomes admin. */
  async createLocal(email: string, displayName: string, passwordHash: string): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [{ total }] = await tx.select({ total: count() }).from(users);
      const [user] = await tx
        .insert(users)
        .values({ email, displayName, role: total === 0 ? 'admin' : 'editor' })
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
