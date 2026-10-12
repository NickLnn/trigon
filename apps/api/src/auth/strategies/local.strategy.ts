import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { hash, verify } from '@node-rs/argon2';
import { Strategy } from 'passport-local';
import { ActivityService } from '../../activity/activity.service';
import type { AuthUser } from '../../common/decorators';
import { IdentityService } from '../../users/identity.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  // Verified against when the e-mail is unknown, so response time doesn't reveal which accounts exist.
  private readonly dummyHash = hash('trigon-timing-equalizer');

  constructor(
    private readonly identity: IdentityService,
    private readonly activity: ActivityService,
  ) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  async validate(email: string, password: string): Promise<AuthUser> {
    const account = await this.identity.findAccount('local', email.trim().toLowerCase());
    const ok = await verify(account?.passwordHash ?? (await this.dummyHash), password).catch(() => false);
    const fail = (reason: string) => {
      this.activity.record({
        action: 'user.sign_in_failed',
        actorId: account?.userId ?? null,
        actorName: email.trim().slice(0, 200),
        details: { method: 'Email and password', reason },
      });
      return new UnauthorizedException(reason === 'Account disabled' ? reason : 'Invalid email or password');
    };
    if (!account) throw fail('Unknown email');
    if (!ok) throw fail('Wrong password');
    const user = await this.identity.toSessionUser(account.userId);
    if (!user) throw fail('Account disabled');
    return { id: user.id, email: user.email, role: user.role };
  }
}
