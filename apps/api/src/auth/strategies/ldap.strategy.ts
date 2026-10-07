import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-custom';
import type { AuthUser } from '../../common/decorators';
import { DirectorySyncService } from '../../directory/directory-sync.service';
import { LdapService } from '../../directory/ldap.service';
import { IdentityService } from '../../users/identity.service';

/** Domain credential login: body { username, password } → bind against LDAP/AD. */
@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldap') {
  constructor(
    private readonly ldap: LdapService,
    private readonly identity: IdentityService,
    private readonly sync: DirectorySyncService,
  ) {
    super();
  }

  async validate(req: Request): Promise<AuthUser> {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    const ldapUser = await this.ldap.authenticate(String(username ?? '').trim(), String(password ?? ''));
    if (!ldapUser) throw new UnauthorizedException('Invalid domain credentials');

    const user = await this.identity.upsertExternal({
      provider: 'ldap',
      providerAccountId: ldapUser.externalId,
      email: ldapUser.email,
      displayName: ldapUser.displayName,
      jobTitle: ldapUser.jobTitle,
      department: ldapUser.department,
      active: true,
      profile: { dn: ldapUser.dn, username: ldapUser.username },
    });
    await this.sync.applyLdapMemberOf(user.id, ldapUser.memberOf);
    return { id: user.id, email: user.email, role: user.role };
  }
}
