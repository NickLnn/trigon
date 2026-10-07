import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { UsersController } from './users.controller';

@Global()
@Module({
  controllers: [UsersController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class UsersModule {}
