import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { DirectorySyncService } from './directory-sync.service';

@Controller('directory')
@Roles('admin')
export class DirectoryController {
  constructor(private readonly sync: DirectorySyncService) {}

  @Get('status')
  status() {
    return this.sync.status();
  }

  /** Starts a sync in the background; poll GET /directory/status for progress and the result. */
  @Post('sync/entra')
  @HttpCode(202)
  syncEntra() {
    return this.sync.start('entra');
  }

  @Post('sync/ldap')
  @HttpCode(202)
  syncLdap() {
    return this.sync.start('ldap');
  }
}
