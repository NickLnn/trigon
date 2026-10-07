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

  @Post('sync/entra')
  @HttpCode(200)
  syncEntra() {
    return this.sync.syncEntra();
  }

  @Post('sync/ldap')
  @HttpCode(200)
  syncLdap() {
    return this.sync.syncLdap();
  }
}
