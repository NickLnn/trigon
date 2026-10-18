import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-custom';
import { ActivityService } from '../../activity/activity.service';
import type { AuthUser } from '../../common/decorators';
import { DirectorySyncService } from '../../directory/directory-sync.service';
import { LdapService, validLdapUsername } from '../../directory/ldap.service';
import { IdentityLinkRefused, IdentityService } from '../../users/identity.service';
import { LoginAttemptsService } from '../login-attempts.service';
import { TokensService } from '../tokens.service';

/** Domain credential login: body { username, password } → bind against LDAP/AD. */
@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldap') {
  constructor(
    private readonly ldap: LdapService,
    private readonly identity: IdentityService,
    private readonly sync: DirectorySyncService,
    private readonly activity: ActivityService,
    private readonly attempts: LoginAttemptsService,
    private readonly tokens: TokensService,
  ) {
    super();
  }

  async validate(req: Request): Promise<AuthUser> {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fail = (reason: string, actorId: string | null = null) => {
      this.activity.record({
        action: 'user.sign_in_failed',
        actorId,
        actorName: username.slice(0, 200),
        details: { method: 'Domain (LDAP)', reason },
      });
    };
    if (!validLdapUsername(username) || !password || password.length > 1024) {
      fail('Malformed credentials');
      throw new UnauthorizedException('Invalid domain credentials');
    }

    const key = LoginAttemptsService.key('ldap', username);
    this.attempts.assertAllowed(key);
    const ldapUser = await this.ldap.authenticate(username, password);
    if (!ldapUser) {
      fail('Invalid domain credentials');
      if (this.attempts.fail(key)) {
        this.activity.record({
          action: 'user.locked',
          actorId: null,
          actorName: username.slice(0, 200),
          details: { method: 'Domain (LDAP)', retryAfterSeconds: Math.ceil(this.attempts.retryAfter(key) / 1000) },
        });
      }
      throw new UnauthorizedException('Invalid domain credentials');
    }
    this.attempts.succeed(key);

    let user;
    try {
      user = await this.identity.upsertExternal(
        {
          provider: 'ldap',
          providerAccountId: ldapUser.externalId,
          email: ldapUser.email,
          displayName: ldapUser.displayName,
          jobTitle: ldapUser.jobTitle,
          department: ldapUser.department,
          active: true,
          profile: { dn: ldapUser.dn, username: ldapUser.username },
        },
        { linkUserId: await this.tokens.sessionUserId(req) },
      );
    } catch (err) {
      if (!(err instanceof IdentityLinkRefused)) throw err;
      fail('Matches a protected account that has not linked LDAP');
      throw new ForbiddenException(err.message);
    }
    if (!user.active) {
      fail('Account disabled', user.id);
      throw new UnauthorizedException('Account disabled');
    }
    await this.sync.applyLdapMemberOf(user.id, ldapUser.memberOf);
    return { id: user.id, email: user.email, role: user.role };
  }
}
