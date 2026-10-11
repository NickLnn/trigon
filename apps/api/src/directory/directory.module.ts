import { Module } from '@nestjs/common';
import { DirectoryController } from './directory.controller';
import { DirectorySyncService } from './directory-sync.service';
import { EntraClientService } from './entra-client.service';
import { EntraRedirectService } from './entra-redirect.service';
import { LdapService } from './ldap.service';

@Module({
  controllers: [DirectoryController],
  providers: [EntraClientService, EntraRedirectService, LdapService, DirectorySyncService],
  exports: [EntraClientService, EntraRedirectService, LdapService, DirectorySyncService],
})
export class DirectoryModule {}
