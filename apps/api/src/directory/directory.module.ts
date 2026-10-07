import { Module } from '@nestjs/common';
import { DirectoryController } from './directory.controller';
import { DirectorySyncService } from './directory-sync.service';
import { EntraClientService } from './entra-client.service';
import { LdapService } from './ldap.service';

@Module({
  controllers: [DirectoryController],
  providers: [EntraClientService, LdapService, DirectorySyncService],
  exports: [EntraClientService, LdapService, DirectorySyncService],
})
export class DirectoryModule {}
