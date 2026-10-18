import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';
import { DirectoryModule } from '../directory/directory.module';
import { AuthController } from './auth.controller';
import { EntraAuthService } from './entra-auth.service';
import { LoginAttemptsService } from './login-attempts.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LdapStrategy } from './strategies/ldap.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { TokensService } from './tokens.service';
import { UserStatusService } from './user-status.service';

@Global()
@Module({
  imports: [
    PassportModule,
    DirectoryModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // Pinned algorithm: tokens signed any other way (e.g. "none") are rejected.
        signOptions: { algorithm: 'HS256', expiresIn: (config.get<string>('JWT_ACCESS_TTL') ?? '15m') as StringValue },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [TokensService, UserStatusService, EntraAuthService, LoginAttemptsService, LocalStrategy, LdapStrategy, JwtStrategy],
  exports: [TokensService, UserStatusService],
})
export class AuthModule {}
