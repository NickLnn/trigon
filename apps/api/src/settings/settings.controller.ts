import { BadRequestException, Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import type { AllSettings, DirectoryPick, EmailMicrosoftStatus, EmailSettings, EntraSettings, LdapSettings } from '@trigon/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CronJob } from 'cron';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { EntraClientService, GRAPH } from '../directory/entra-client.service';
import { EntraRedirectService } from '../directory/entra-redirect.service';
import { LdapService } from '../directory/ldap.service';
import { EmailService } from '../email/email.service';
import { EMAIL_PREVIEWS, previewHtml } from '../email/previews';
import { EntraProvisionerService } from './entra-provisioner.service';
import { SettingsService } from './settings.service';

class GeneralDto {
  @IsOptional() @IsBoolean() allowLocalSignup?: boolean;
  /** Full addresses; reduced to scheme://host[:port]. Empty clears. */
  @IsOptional() @IsString() @MaxLength(300) internalUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) publicUrl?: string;
  @IsOptional() @IsBoolean() setupDone?: boolean;
}

/** "trigon.example.com/" → "https://trigon.example.com"; rejects anything that isn't http(s). */
export function originOf(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^https?:\/\//i.test(v)) throw new BadRequestException(`"${v}" must start with http:// or https://`);
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(v) ? v : `${field === 'publicUrl' ? 'https' : 'http'}://${v}`);
  } catch {
    throw new BadRequestException(`"${v}" is not a web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException(`"${v}" must start with http:// or https://`);
  return url.origin;
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

class ProvisionDto {
  /** The HTTPS address people open Trigon at, confirmed by the admin. */
  @IsString() @MaxLength(300) publicUrl: string;
  /** Also grant Mail.Send so Trigon can send email through Exchange Online. */
  @IsOptional() @IsBoolean() mail?: boolean;
}

class EmailDto {
  @IsIn(['none', 'smtp', 'microsoft']) provider: EmailSettings['provider'];
  @ValidateIf((o: EmailDto) => o.provider !== 'none') @IsEmail() fromAddress: string;
  @IsString() @MaxLength(120) fromName: string;
  @IsString() @MaxLength(255) smtpHost: string;
  @IsInt() @Min(1) @Max(65535) smtpPort: number;
  @IsIn(['tls', 'starttls', 'none']) smtpSecurity: EmailSettings['smtpSecurity'];
  @IsString() @MaxLength(255) smtpUser: string;
  @IsOptional() @IsString() @MaxLength(500) smtpPassword?: string;
  @IsBoolean() smtpTlsRejectUnauthorized: boolean;
}

class EmailTestDto extends EmailDto {
  /** Where to send the test message. */
  @IsEmail() to: string;
}

@Controller('settings')
@Roles('admin')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
    private readonly provisioner: EntraProvisionerService,
    private readonly entraClient: EntraClientService,
    private readonly redirects: EntraRedirectService,
    private readonly activity: ActivityService,
    private readonly email: EmailService,
  ) {}

  /** Only which fields were saved is logged, never their values (they include secrets). */
  private recordSave(userId: string, section: string, dto: object) {
    this.activity.record({
      action: 'settings.updated',
      actorId: userId,
      target: { type: 'settings', id: null, name: section },
      details: { fields: Object.keys(dto) },
    });
  }

  @Get()
  async all(): Promise<AllSettings> {
    const signIn = await this.redirects.ensure();
    const publicUrl = await this.settings.knownPublicUrl();
    return {
      general: await this.settings.getPublic('general'),
      entra: await this.settings.getPublic('entra'),
      ldap: await this.settings.getPublic('ldap'),
      email: await this.settings.getPublic('email'),
      info: {
        internalUrl: await this.settings.internalUrl(),
        publicUrl,
        entraRedirectUri: publicUrl?.startsWith('https://') ? `${publicUrl}/api/auth/entra/callback` : (signIn.redirectUris[0] ?? ''),
        httpsWarning: !publicUrl?.startsWith('https://'),
        entraSignIn: signIn,
      },
    };
  }

  @Put('general')
  async general(@CurrentUser() user: AuthUser, @Body() dto: GeneralDto) {
    const patch = { ...dto, internalUrl: originOf(dto.internalUrl, 'internalUrl'), publicUrl: originOf(dto.publicUrl, 'publicUrl') };
    for (const k of ['internalUrl', 'publicUrl'] as const) if (patch[k] === undefined) delete patch[k];
    await this.settings.update('general', patch, user.id);
    // A public HTTPS address is also where Microsoft sign-in has to send people back to.
    if (patch.publicUrl?.startsWith('https://')) await this.redirects.confirmOrigin(patch.publicUrl).catch(() => undefined);
    this.recordSave(user.id, 'General', dto);
    return this.settings.getPublic('general');
  }

  @Put('entra')
  async entra(@CurrentUser() user: AuthUser, @Body() dto: EntraDto) {
    assertCron(dto.syncCron);
    await this.settings.update('entra', dto as Partial<EntraSettings>, user.id);
    this.recordSave(user.id, 'Microsoft Entra ID', dto);
    return this.settings.getPublic('entra');
  }

  @Put('ldap')
  async ldapSave(@CurrentUser() user: AuthUser, @Body() dto: LdapDto) {
    assertCron(dto.syncCron);
    await this.settings.update('ldap', dto as Partial<LdapSettings>, user.id);
    this.recordSave(user.id, 'LDAP / Active Directory', dto);
    return this.settings.getPublic('ldap');
  }

  @Put('email')
  async emailSave(@CurrentUser() user: AuthUser, @Body() dto: EmailDto) {
    await this.settings.update('email', dto as Partial<EmailSettings>, user.id);
    this.recordSave(user.id, 'Email', dto);
    return this.settings.getPublic('email');
  }

  /** Send a test message with the settings on screen (stored password used when the field is empty). */
  @Post('email/test')
  @HttpCode(200)
  async emailTest(@Body() dto: EmailTestDto) {
    const { to, ...form } = dto;
    return this.email.test(form as EmailSettings, to);
  }

  /** The sample emails an admin can preview (made-up data, nothing is sent). */
  @Get('email/previews')
  emailPreviews() {
    return Object.entries(EMAIL_PREVIEWS).map(([kind, p]) => ({ kind, label: p.label }));
  }

  @Get('email/preview/:kind')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async emailPreview(@Param('kind') kind: string) {
    const html = previewHtml(kind, await this.settings.publicUrl());
    if (!html) throw new NotFoundException();
    return html;
  }

  /** Whether the Entra app may send mail (Mail.Send). */
  @Get('email/microsoft')
  emailMicrosoft(): Promise<EmailMicrosoftStatus> {
    return this.email.microsoftStatus();
  }

  /** Save which groups / users Microsoft sync imports (the "who gets access" picker). */
  @Put('entra/scope')
  async entraScope(@CurrentUser() user: AuthUser, @Body() dto: EntraScopeDto) {
    await this.settings.update('entra', dto as Partial<EntraSettings>, user.id);
    this.recordSave(user.id, 'Microsoft Entra ID (sync scope)', dto);
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
  provision(@CurrentUser() user: AuthUser, @Body() dto: ProvisionDto) {
    return this.provisioner.start(user.id, dto.publicUrl, dto.mail ?? false);
  }

  @Post('entra/disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.provisioner.disconnect(user.id);
  }

  @Get('entra/provision')
  provisionStatus() {
    return this.provisioner.current();
  }
}
