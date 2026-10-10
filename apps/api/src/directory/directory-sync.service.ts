import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { GroupSource, SyncResult, SyncSourceStatus } from '@trigon/shared';
import { CronJob } from 'cron';
import { and, count, eq, inArray, isNull, max, ne, notInArray, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { accounts, groupMembers, groups, refreshTokens, users } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { IdentityService } from '../users/identity.service';
import { EntraClientService } from './entra-client.service';
import { LdapService } from './ldap.service';

interface GraphUser {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
  accountEnabled: boolean;
}
interface GraphGroup {
  id: string;
  displayName: string;
  description: string | null;
}
interface GraphMember extends Partial<GraphUser> {
  '@odata.type': string;
  id: string;
}

const USER_SELECT = 'id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled';
type Source = 'entra' | 'ldap';

/**
 * Pulls users, groups and memberships from Entra ID (Graph) and LDAP into Trigon's tables.
 * Synced groups are what RBAC grants point at, so access follows the directory automatically.
 *
 * Entra supports a scope: the whole tenant, or only chosen groups (with nested members) plus chosen
 * users. People who fall out of scope are deactivated (never deleted, and never admins).
 * Syncs run in the background; status() reports progress and the last result.
 */
@Injectable()
export class DirectorySyncService implements OnModuleInit {
  private readonly logger = new Logger(DirectorySyncService.name);
  private running = new Map<Source, Date>();
  private last = new Map<Source, { result: (SyncResult & { finishedAt: string }) | null; error: string | null }>();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly identity: IdentityService,
    private readonly entra: EntraClientService,
    private readonly ldap: LdapService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    await this.reschedule('entra');
    await this.reschedule('ldap');
    this.settings.changes.on('changed', (key) => {
      if (key === 'entra' || key === 'ldap') this.reschedule(key).catch((e) => this.logger.error(e.message));
    });
  }

  /** (Re)create the cron job for a source from its current settings. */
  private async reschedule(source: Source) {
    const name = `directory-sync-${source}`;
    if (this.scheduler.doesExist('cron', name)) this.scheduler.deleteCronJob(name);
    const enabled = source === 'entra' ? await this.entra.enabled() : await this.ldap.enabled();
    const { syncCron } = await this.settings.get(source);
    if (!enabled || !syncCron) return;
    const job = CronJob.from({ cronTime: syncCron, onTick: () => void this.run(source).catch(() => undefined) });
    this.scheduler.addCronJob(name, job);
    job.start();
    this.logger.log(`Scheduled ${source} directory sync: ${syncCron}`);
  }

  /** Start a sync in the background and return immediately (the UI polls status()). */
  start(source: Source): { started: boolean } {
    if (this.running.has(source)) throw new ConflictException(`A ${source === 'entra' ? 'Microsoft' : 'LDAP'} sync is already running`);
    void this.run(source).catch(() => undefined);
    return { started: true };
  }

  /** Run a sync to completion (cron, tests). Records the outcome for status(). */
  async run(source: Source): Promise<SyncResult> {
    if (this.running.has(source)) throw new ConflictException(`${source} sync already running`);
    this.running.set(source, new Date());
    try {
      const result = source === 'entra' ? await this.syncEntra() : await this.syncLdap();
      this.last.set(source, { result: { ...result, finishedAt: new Date().toISOString() }, error: null });
      this.logger.log(`${source} sync: ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      const message = (err as Error).message;
      this.last.set(source, { result: this.last.get(source)?.result ?? null, error: message });
      this.logger.error(`${source} sync failed: ${message}`);
      throw err;
    } finally {
      this.running.delete(source);
    }
  }

  private async upsertGroup(source: GroupSource, externalId: string, name: string, description: string | null) {
    const [g] = await this.db
      .insert(groups)
      .values({ source, externalId, name, description, lastSyncedAt: new Date() })
      .onConflictDoUpdate({
        target: [groups.source, groups.externalId],
        set: { name, description, lastSyncedAt: new Date() },
      })
      .returning({ id: groups.id });
    return g.id;
  }

  /** Replace a group's membership with exactly `userIds`. */
  private async setMembers(groupId: string, userIds: string[]) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(groupMembers)
        .where(userIds.length ? and(eq(groupMembers.groupId, groupId), notInArray(groupMembers.userId, userIds)) : eq(groupMembers.groupId, groupId));
      if (userIds.length) {
        await tx
          .insert(groupMembers)
          .values(userIds.map((userId) => ({ groupId, userId })))
          .onConflictDoNothing();
      }
    });
  }

  /** Remove groups of this source that are no longer in the directory / in scope. */
  private async pruneGroups(source: GroupSource, keepExternalIds: string[]) {
    await this.db
      .delete(groups)
      .where(keepExternalIds.length ? and(eq(groups.source, source), notInArray(groups.externalId, keepExternalIds)) : eq(groups.source, source));
  }

  /**
   * Deactivate people whose only way in was this directory and who are no longer synced.
   * Admins and anyone with a local or other-directory login are left alone. Returns how many.
   */
  private async deactivateOutOfScope(provider: Source, keepAccountIds: string[]): Promise<number> {
    const stale = await this.db
      .select({ userId: accounts.userId })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(
        and(
          eq(accounts.provider, provider),
          keepAccountIds.length ? notInArray(accounts.providerAccountId, keepAccountIds) : undefined,
          eq(users.active, true),
          ne(users.role, 'admin'),
          sql`not exists (select 1 from ${accounts} a2 where a2.user_id = ${accounts.userId} and a2.provider <> ${provider})`,
        ),
      );
    const ids = [...new Set(stale.map((s) => s.userId))];
    if (!ids.length) return 0;
    await this.db.update(users).set({ active: false }).where(inArray(users.id, ids));
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(inArray(refreshTokens.userId, ids), isNull(refreshTokens.revokedAt)));
    await this.db.delete(groupMembers).where(inArray(groupMembers.userId, ids));
    return ids.length;
  }

  private async upsertGraphUser(gu: GraphUser) {
    const user = await this.identity.upsertExternal({
      provider: 'entra',
      providerAccountId: gu.id,
      email: gu.mail ?? gu.userPrincipalName,
      displayName: gu.displayName ?? gu.userPrincipalName,
      jobTitle: gu.jobTitle,
      department: gu.department,
      active: gu.accountEnabled,
      profile: { ...gu },
    });
    return user.id;
  }

  private async syncEntra(): Promise<SyncResult> {
    const started = Date.now();
    const cfg = await this.settings.get('entra');
    const byExternal = new Map<string, string>(); // Graph user id → Trigon user id
    let memberships = 0;
    let groupCount = 0;
    let keepGroups: string[] = [];

    if (cfg.syncScope === 'selected') {
      // Chosen groups (with nested members) …
      for (const pick of cfg.syncGroups) {
        const gg = await this.entra.graphGet<GraphGroup>(`/groups/${pick.id}?$select=id,displayName,description`);
        if (!gg) continue; // deleted in the tenant
        const members = await this.entra.graphList<GraphMember>(`/groups/${gg.id}/transitiveMembers/microsoft.graph.user?$select=${USER_SELECT}&$top=999`);
        const userIds: string[] = [];
        for (const m of members) {
          if (!m.userPrincipalName) continue;
          if (!byExternal.has(m.id)) byExternal.set(m.id, await this.upsertGraphUser(m as GraphUser));
          userIds.push(byExternal.get(m.id)!);
        }
        await this.setMembers(await this.upsertGroup('entra', gg.id, gg.displayName, gg.description), userIds);
        memberships += userIds.length;
        keepGroups.push(gg.id);
        groupCount++;
      }
      // … plus individually chosen users.
      for (const pick of cfg.syncUsers) {
        if (byExternal.has(pick.id)) continue;
        const gu = await this.entra.graphGet<GraphUser>(`/users/${pick.id}?$select=${USER_SELECT}`);
        if (gu) byExternal.set(gu.id, await this.upsertGraphUser(gu));
      }
    } else {
      for (const gu of await this.entra.graphList<GraphUser>(`/users?$select=${USER_SELECT}&$top=999`)) {
        byExternal.set(gu.id, await this.upsertGraphUser(gu));
      }
      const graphGroups = await this.entra.graphList<GraphGroup>('/groups?$select=id,displayName,description&$top=999');
      for (const gg of graphGroups) {
        // transitiveMembers flattens nested groups so RBAC on a parent group covers its sub-groups
        const members = await this.entra.graphList<GraphMember>(`/groups/${gg.id}/transitiveMembers?$select=id&$top=999`);
        const userIds = members
          .filter((m) => m['@odata.type'] === '#microsoft.graph.user')
          .map((m) => byExternal.get(m.id))
          .filter((id): id is string => !!id);
        await this.setMembers(await this.upsertGroup('entra', gg.id, gg.displayName, gg.description), userIds);
        memberships += userIds.length;
      }
      keepGroups = graphGroups.map((g) => g.id);
      groupCount = graphGroups.length;
    }

    await this.pruneGroups('entra', keepGroups);
    const deactivated = await this.deactivateOutOfScope('entra', [...byExternal.keys()]);
    return { source: 'entra', users: byExternal.size, groups: groupCount, memberships, deactivated, durationMs: Date.now() - started };
  }

  private async syncLdap(): Promise<SyncResult> {
    const started = Date.now();
    const ldapUsers = await this.ldap.listUsers();
    const byDn = new Map<string, string>();
    for (const lu of ldapUsers) {
      const user = await this.identity.upsertExternal({
        provider: 'ldap',
        providerAccountId: lu.externalId,
        email: lu.email,
        displayName: lu.displayName,
        jobTitle: lu.jobTitle,
        department: lu.department,
        active: !lu.disabled,
        profile: { dn: lu.dn, username: lu.username },
      });
      byDn.set(lu.dn.toLowerCase(), user.id);
    }

    const ldapGroups = await this.ldap.listGroups();
    let memberships = 0;
    for (const lg of ldapGroups) {
      const groupId = await this.upsertGroup('ldap', lg.dn, lg.name, lg.description);
      const userIds = lg.members.map((dn) => byDn.get(dn.toLowerCase())).filter((id): id is string => !!id);
      await this.setMembers(groupId, userIds);
      memberships += userIds.length;
    }
    if (ldapGroups.length) await this.pruneGroups('ldap', ldapGroups.map((g) => g.dn));
    const deactivated = ldapUsers.length ? await this.deactivateOutOfScope('ldap', ldapUsers.map((u) => u.externalId)) : 0;
    return { source: 'ldap', users: ldapUsers.length, groups: ldapGroups.length, memberships, deactivated, durationMs: Date.now() - started };
  }

  /** On LDAP login, refresh this user's group memberships from memberOf without a full sync. */
  async applyLdapMemberOf(userId: string, memberOf: string[]) {
    if (!memberOf.length) return;
    const known = await this.db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.source, 'ldap'), inArray(groups.externalId, memberOf)));
    if (known.length) {
      await this.db
        .insert(groupMembers)
        .values(known.map((g) => ({ groupId: g.id, userId })))
        .onConflictDoNothing();
    }
  }

  async status(): Promise<{ entra: SyncSourceStatus; ldap: SyncSourceStatus }> {
    const lastSync = await this.db
      .select({ source: groups.source, at: max(groups.lastSyncedAt) })
      .from(groups)
      .groupBy(groups.source);
    const linked = await this.db
      .select({ provider: accounts.provider, total: count() })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(eq(users.active, true))
      .groupBy(accounts.provider);
    const [entraOn, ldapOn] = [await this.entra.enabled(), await this.ldap.enabled()];
    const describe = (s: Source, enabled: boolean): SyncSourceStatus => ({
      enabled,
      running: this.running.has(s),
      startedAt: this.running.get(s)?.toISOString() ?? null,
      lastResult: this.last.get(s)?.result ?? null,
      lastError: this.last.get(s)?.error ?? null,
      lastGroupSync: lastSync.find((r) => r.source === s)?.at?.toISOString() ?? null,
      accounts: linked.find((r) => r.provider === s)?.total ?? 0,
    });
    return { entra: describe('entra', entraOn), ldap: describe('ldap', ldapOn) };
  }
}
