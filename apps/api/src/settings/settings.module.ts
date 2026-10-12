import { Global, Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { EmailService } from '../email/email.service';
import { AdminController } from './admin.controller';
import { EntraProvisionerService } from './entra-provisioner.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** SettingsService is global (directory/auth depend on it); the admin controllers live here too. */
@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsCoreModule {}

/** Outgoing email, available to every module that wants to notify someone. */
@Global()
@Module({ imports: [DirectoryModule], providers: [EmailService], exports: [EmailService] })
export class EmailModule {}

@Module({
  imports: [DirectoryModule, EmailModule],
  controllers: [SettingsController, AdminController],
  providers: [EntraProvisionerService],
})
export class SettingsModule {}
