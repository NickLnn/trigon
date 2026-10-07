import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { GroupSource } from '@trigon/shared';
import { CronJob } from 'cron';
import { and, count, eq, inArray, max, notInArray } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { accounts, groupMembers, groups } from '../db/schema';
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
  securityEnabled: boolean;
}
interface GraphMember {
  '@odata.type': string;
  id: string;
}

export interface SyncResult {
  source: GroupSource;
  users: number;
  groups: number;
  memberships: number;
  durationMs: number;
}

/**
 * Pulls users, groups and memberships from Entra ID (Graph) and LDAP into Trigon's tables.
 * Synced groups are what RBAC grants point at, so access follows the directory automatically.
 */
@Injectable()
export class DirectorySyncService implements OnModuleInit {
  private readonly logger = new Logger(DirectorySyncService.name);
  private running = new Set<GroupSource>();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly config: ConfigService,
    private readonly identity: IdentityService,
    private readonly entra: EntraClientService,
    private readonly ldap: LdapService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    this.schedule('entra', this.entra.enabled, this.config.get('ENTRA_SYNC_CRON'), () => this.syncEntra());
    this.schedule('ldap', this.ldap.enabled, this.config.get('LDAP_SYNC_CRON'), () => this.syncLdap());
  }

  private schedule(name: string, enabled: boolean, cron: string | undefined, fn: () => Promise<unknown>) {
    if (!enabled || !cron) return;
    const job = CronJob.from({
      cronTime: cron,
      onTick: async () => {
        await fn().catch((err: Error) => this.logger.error(`${name} sync failed: ${err.message}`));
      },
    });
    this.scheduler.addCronJob(`directory-sync-${name}`, job);
    job.start();
    this.logger.log(`Scheduled ${name} directory sync: ${cron}`);
  }

  private async guard<T>(source: GroupSource, fn: () => Promise<T>): Promise<T> {
    if (this.running.has(source)) throw new Error(`${source} sync already running`);
    this.running.add(source);
    try {
      return await fn();
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
        .where(
          userIds.length
            ? and(eq(groupMembers.groupId, groupId), notInArray(groupMembers.userId, userIds))
            : eq(groupMembers.groupId, groupId),
        );
      if (userIds.length) {
        await tx
          .insert(groupMembers)
          .values(userIds.map((userId) => ({ groupId, userId })))
          .onConflictDoNothing();
      }
    });
  }

  /** Remove groups of this source that no longer exist in the directory. */
  private async pruneGroups(source: GroupSource, keepExternalIds: string[]) {
    if (!keepExternalIds.length) return;
    await this.db.delete(groups).where(and(eq(groups.source, source), notInArray(groups.externalId, keepExternalIds)));
  }

  async syncEntra(): Promise<SyncResult> {
    return this.guard('entra', async () => {
      const started = Date.now();
      const graphUsers = await this.entra.graphList<GraphUser>(
        '/users?$select=id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled&$top=999',
      );
      const byExternal = new Map<string, string>();
      for (const gu of graphUsers) {
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
        byExternal.set(gu.id, user.id);
      }

      const graphGroups = await this.entra.graphList<GraphGroup>(
        '/groups?$select=id,displayName,description,securityEnabled&$top=999',
      );
      let memberships = 0;
      for (const gg of graphGroups) {
        const groupId = await this.upsertGroup('entra', gg.id, gg.displayName, gg.description);
        // transitiveMembers flattens nested groups so RBAC on a parent group covers its sub-groups
        const members = await this.entra.graphList<GraphMember>(`/groups/${gg.id}/transitiveMembers?$select=id&$top=999`);
        const userIds = members
          .filter((m) => m['@odata.type'] === '#microsoft.graph.user')
          .map((m) => byExternal.get(m.id))
          .filter((id): id is string => !!id);
        await this.setMembers(groupId, userIds);
        memberships += userIds.length;
      }
      await this.pruneGroups('entra', graphGroups.map((g) => g.id));

      const result = { source: 'entra' as const, users: graphUsers.length, groups: graphGroups.length, memberships, durationMs: Date.now() - started };
      this.logger.log(`Entra sync: ${JSON.stringify(result)}`);
      return result;
    });
  }

  async syncLdap(): Promise<SyncResult> {
    return this.guard('ldap', async () => {
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
      await this.pruneGroups('ldap', ldapGroups.map((g) => g.dn));

      const result = { source: 'ldap' as const, users: ldapUsers.length, groups: ldapGroups.length, memberships, durationMs: Date.now() - started };
      this.logger.log(`LDAP sync: ${JSON.stringify(result)}`);
      return result;
    });
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

  async status() {
    const lastSync = await this.db
      .select({ source: groups.source, at: max(groups.lastSyncedAt) })
      .from(groups)
      .groupBy(groups.source);
    const linked = await this.db
      .select({ provider: accounts.provider, total: count() })
      .from(accounts)
      .groupBy(accounts.provider);
    const describe = (s: GroupSource, enabled: boolean) => ({
      enabled,
      running: this.running.has(s),
      lastGroupSync: lastSync.find((r) => r.source === s)?.at ?? null,
      accounts: linked.find((r) => r.provider === s)?.total ?? 0,
    });
    return { entra: describe('entra', this.entra.enabled), ldap: describe('ldap', this.ldap.enabled) };
  }
}
