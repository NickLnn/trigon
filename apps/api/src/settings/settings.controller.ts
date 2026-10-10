import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import type { AllSettings, DirectoryPick, EntraSettings, LdapSettings } from '@trigon/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { CronJob } from 'cron';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { EntraClientService, GRAPH } from '../directory/entra-client.service';
import { LdapService } from '../directory/ldap.service';
import { EntraProvisionerService } from './entra-provisioner.service';
import { SettingsService } from './settings.service';

class GeneralDto {
  @IsBoolean()
  allowLocalSignup: boolean;
}

class PickDto {
  @IsString() @MaxLength(100) id: string;
  @IsString() @MaxLength(300) name: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(300) detail?: string | null;
}

class EntraScopeDto {
  @IsIn(['all', 'selected']) syncScope: 'all' | 'selected';
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PickDto) syncGroups: PickDto[];
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => PickDto) syncUsers: PickDto[];
}

class EntraDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MaxLength(100) tenantId: string;
  @IsString() @MaxLength(100) clientId: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) clientSecret?: string | null;
  @IsString() @MaxLength(500) redirectUri: string;
  @IsString() @MaxLength(100) syncCron: string;
}

class LdapDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MaxLength(500) url: string;
  @IsString() @MaxLength(500) bindDn: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) bindPassword?: string | null;
  @IsString() @MaxLength(500) searchBase: string;
  @IsString() @MaxLength(1000) userFilter: string;
  @IsString() @MaxLength(1000) syncUserFilter: string;
  @IsString() @MaxLength(1000) groupFilter: string;
  @Type(() => Boolean) @IsBoolean() tlsRejectUnauthorized: boolean;
  @IsString() @MaxLength(100) syncCron: string;
}

function assertCron(expr: string) {
  if (!expr) return;
  try {
    CronJob.from({ cronTime: expr, onTick: () => undefined });
  } catch {
    throw new BadRequestException(`Invalid schedule "${expr}"`);
  }
}

@Controller('settings')
@Roles('admin')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
    private readonly provisioner: EntraProvisionerService,
    private readonly entraClient: EntraClientService,
  ) {}

  @Get()
  async all(): Promise<AllSettings> {
    const appUrl = this.settings.appUrl();
    return {
      general: await this.settings.getPublic('general'),
      entra: await this.settings.getPublic('entra'),
      ldap: await this.settings.getPublic('ldap'),
      info: {
        appUrl,
        entraRedirectUri: await this.settings.entraRedirectUri(),
        httpsWarning: !appUrl.startsWith('https://') && !appUrl.includes('localhost'),
      },
    };
  }

  @Put('general')
  async general(@CurrentUser() user: AuthUser, @Body() dto: GeneralDto) {
    await this.settings.update('general', dto, user.id);
    return this.settings.getPublic('general');
  }

  @Put('entra')
  async entra(@CurrentUser() user: AuthUser, @Body() dto: EntraDto) {
    assertCron(dto.syncCron);
    await this.settings.update('entra', dto as Partial<EntraSettings>, user.id);
    return this.settings.getPublic('entra');
  }

  @Put('ldap')
  async ldapSave(@CurrentUser() user: AuthUser, @Body() dto: LdapDto) {
    assertCron(dto.syncCron);
    await this.settings.update('ldap', dto as Partial<LdapSettings>, user.id);
    return this.settings.getPublic('ldap');
  }

  /** Save which groups / users Microsoft sync imports (the "who gets access" picker). */
  @Put('entra/scope')
  async entraScope(@CurrentUser() user: AuthUser, @Body() dto: EntraScopeDto) {
    await this.settings.update('entra', dto as Partial<EntraSettings>, user.id);
    return this.settings.getPublic('entra');
  }

  /** Search the tenant's groups or users for the picker (app-only Graph token). */
  @Get('entra/directory')
  async searchDirectory(@Query('type') type: string, @Query('q') q = ''): Promise<DirectoryPick[]> {
    const term = q.trim().replace(/"/g, '');
    try {
      if (type === 'group') {
        const rows = await this.entraClient.graphPage<{ id: string; displayName: string; description: string | null; mail: string | null; securityEnabled: boolean }>(
          term
            ? `/groups?$search="displayName:${encodeURIComponent(term)}"&$select=id,displayName,description,mail,securityEnabled&$top=30&$count=true&$orderby=displayName`
            : '/groups?$select=id,displayName,description,mail,securityEnabled&$top=30&$count=true&$orderby=displayName',
        );
        return rows.map((g) => ({ id: g.id, name: g.displayName, detail: g.description || g.mail || (g.securityEnabled ? 'Security group' : 'Microsoft 365 group') }));
      }
      const rows = await this.entraClient.graphPage<{ id: string; displayName: string; mail: string | null; userPrincipalName: string }>(
        term
          ? `/users?$search="displayName:${encodeURIComponent(term)}" OR "mail:${encodeURIComponent(term)}"&$select=id,displayName,mail,userPrincipalName&$top=30&$count=true&$orderby=displayName`
          : '/users?$select=id,displayName,mail,userPrincipalName&$top=30&$count=true&$orderby=displayName',
      );
      return rows.map((u) => ({ id: u.id, name: u.displayName, detail: u.mail ?? u.userPrincipalName }));
    } catch (err) {
      throw new BadRequestException(`Microsoft Graph: ${(err as Error).message.slice(0, 300)}`);
    }
  }

  /** Check credentials before (or after) saving: client-credentials token + read the organisation. */
  @Post('entra/test')
  @HttpCode(200)
  async testEntra(@Body() dto: EntraDto) {
    const stored = await this.settings.get('entra');
    const s = { ...dto, clientSecret: dto.clientSecret || stored.clientSecret };
    if (!s.tenantId || !s.clientId || !s.clientSecret) throw new BadRequestException('Tenant ID, client ID and secret are required');
    try {
      const token = await EntraClientService.appToken(EntraClientService.build(s));
      const res = await fetch(`${GRAPH}/users?$top=1&$select=id`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        return { ok: false, message: `Signed in, but reading users failed (${res.status}). Has admin consent been granted for User.Read.All?` };
      }
      return { ok: true, message: 'Connected to Microsoft Graph and can read the directory.' };
    } catch (err) {
      return { ok: false, message: (err as Error).message.split('\n')[0] };
    }
  }

  @Post('ldap/test')
  @HttpCode(200)
  async testLdap(@Body() dto: LdapDto) {
    const stored = await this.settings.get('ldap');
    try {
      const r = await this.ldap.test({ ...dto, bindPassword: dto.bindPassword || stored.bindPassword } as LdapSettings);
      return { ok: true, message: `Connected. Found ${r.users} users and ${r.groups} groups with the current filters.` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  @Post('entra/provision')
  @HttpCode(200)
  provision(@CurrentUser() user: AuthUser) {
    return this.provisioner.start(user.id);
  }

  @Get('entra/provision')
  provisionStatus() {
    return this.provisioner.current();
  }
}
