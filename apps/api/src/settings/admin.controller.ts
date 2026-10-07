import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { AdminGroup, AdminUser, AuthProvider } from '@trigon/shared';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { accounts, groupMembers, groups, refreshTokens, users } from '../db/schema';
import { IdentityService } from '../users/identity.service';

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(120) displayName: string;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
  @IsIn(['admin', 'member', 'guest']) role: 'admin' | 'member' | 'guest';
}

class UpdateUserDto {
  @IsOptional() @IsIn(['admin', 'member', 'guest']) role?: 'admin' | 'member' | 'guest';
  @IsOptional() active?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) displayName?: string;
}

class PasswordDto {
  @IsString() @MinLength(10) @MaxLength(200) password: string;
}

class GroupDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

class MemberDto {
  @IsUUID() userId: string;
}

/** User & group management (admin only). Directory-synced groups are read-only here. */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly identity: IdentityService,
  ) {}

  @Get('users')
  async users(@Query('q') q = ''): Promise<AdminUser[]> {
    const term = `%${q.trim()}%`;
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        providers: sql<AuthProvider[]>`coalesce((select array_agg(distinct a.provider) from ${accounts} a where a.user_id = ${users.id}), '{}')`,
        groups: sql<number>`(select count(*)::int from ${groupMembers} gm where gm.user_id = ${users.id})`,
      })
      .from(users)
      .where(q ? or(ilike(users.displayName, term), ilike(users.email, term)) : undefined)
      .orderBy(desc(users.active), asc(users.displayName))
      .limit(500);
    return rows.map((r) => ({
      ...r,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Post('users')
  async createUser(@Body() dto: CreateUserDto) {
    if (await this.identity.findUserByEmail(dto.email)) throw new ConflictException('A user with this email already exists');
    const user = await this.identity.createLocal(dto.email.trim(), dto.displayName.trim(), await hash(dto.password));
    if (dto.role !== user.role) await this.db.update(users).set({ role: dto.role }).where(eq(users.id, user.id));
    return { id: user.id };
  }

  private async otherActiveAdmins(exceptId: string) {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptId)));
    return n;
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    const losesAdmin = (dto.role && dto.role !== 'admin') || dto.active === false;
    if (losesAdmin) {
      const [target] = await this.db.select().from(users).where(eq(users.id, id));
      if (!target) throw new NotFoundException();
      if (target.role === 'admin' && (await this.otherActiveAdmins(id)) === 0) {
        throw new ForbiddenException('Trigon needs at least one active admin');
      }
      if (id === me.id && dto.active === false) throw new ForbiddenException('You cannot deactivate yourself');
    }
    await this.db.update(users).set(dto).where(eq(users.id, id));
    if (dto.active === false) {
      // Sign the user out everywhere.
      await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    }
    return { ok: true };
  }

  /** Set (or create) the local password for a user, e.g. a directory user who also needs local login. */
  @Post('users/:id/password')
  async setPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PasswordDto) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) throw new NotFoundException();
    const passwordHash = await hash(dto.password);
    const local = await this.identity.findAccount('local', user.email.toLowerCase());
    if (local) await this.db.update(accounts).set({ passwordHash }).where(eq(accounts.id, local.id));
    else await this.db.insert(accounts).values({ userId: id, provider: 'local', providerAccountId: user.email.toLowerCase(), passwordHash });
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    return { ok: true };
  }

  @Get('groups')
  async groups(@Query('q') q = ''): Promise<AdminGroup[]> {
    const rows = await this.db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        source: groups.source,
        lastSyncedAt: groups.lastSyncedAt,
        members: sql<number>`(select count(*)::int from ${groupMembers} gm where gm.group_id = ${groups.id})`,
      })
      .from(groups)
      .where(q ? ilike(groups.name, `%${q.trim()}%`) : undefined)
      .orderBy(asc(groups.source), asc(groups.name))
      .limit(1000);
    return rows.map((r) => ({ ...r, lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null }));
  }

  @Post('groups')
  async createGroup(@Body() dto: GroupDto) {
    const [g] = await this.db.insert(groups).values({ ...dto, source: 'local' }).returning({ id: groups.id });
    return g;
  }

  private async localGroup(id: string) {
    const [g] = await this.db.select().from(groups).where(eq(groups.id, id));
    if (!g) throw new NotFoundException();
    if (g.source !== 'local') throw new BadRequestException(`This group is managed by ${g.source === 'entra' ? 'Microsoft Entra ID' : 'LDAP'} sync`);
    return g;
  }

  @Delete('groups/:id')
  async deleteGroup(@Param('id', ParseUUIDPipe) id: string) {
    await this.localGroup(id);
    await this.db.delete(groups).where(eq(groups.id, id));
    return { ok: true };
  }

  @Get('groups/:id/members')
  members(@Param('id', ParseUUIDPipe) id: string) {
    return this.db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, id))
      .orderBy(asc(users.displayName));
  }

  @Post('groups/:id/members')
  async addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberDto) {
    await this.localGroup(id);
    await this.db.insert(groupMembers).values({ groupId: id, userId: dto.userId }).onConflictDoNothing();
    return { ok: true };
  }

  @Delete('groups/:id/members/:userId')
  async removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.localGroup(id);
    await this.db.delete(groupMembers).where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)));
    return { ok: true };
  }
}
