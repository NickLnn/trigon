import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSION_LEVELS, type PermissionLevel } from '@trigon/shared';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { eq } from 'drizzle-orm';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { permissions } from '../db/schema';
import { PermissionsService } from './permissions.service';

class GrantDto {
  @IsIn(['space', 'document'])
  resourceType: 'space' | 'document';

  @IsUUID()
  resourceId: string;

  @IsIn(['user', 'group', 'everyone'])
  subjectType: 'user' | 'group' | 'everyone';

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsIn(PERMISSION_LEVELS as unknown as string[])
  level: PermissionLevel;
}

/** Sharing. Managing grants on a resource requires 'manage' on it. */
@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly perms: PermissionsService,
    @InjectDb() private readonly db: Database,
  ) {}

  private assertManage(user: AuthUser, type: 'space' | 'document', id: string) {
    return type === 'space' ? this.perms.assertSpace(user, id, 'manage') : this.perms.assertDocument(user, id, 'manage');
  }

  @Get(':type/:id')
  async list(@CurrentUser() user: AuthUser, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    if (type !== 'space' && type !== 'document') throw new BadRequestException();
    await this.assertManage(user, type, id);
    return this.perms.list(type, id);
  }

  @Post()
  async grant(@CurrentUser() user: AuthUser, @Body() dto: GrantDto) {
    if (dto.subjectType !== 'everyone' && !dto.subjectId) throw new BadRequestException('subjectId required');
    await this.assertManage(user, dto.resourceType, dto.resourceId);
    return this.perms.grant({ ...dto, subjectId: dto.subjectId ?? null, grantedById: user.id });
  }

  @Delete(':id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.select().from(permissions).where(eq(permissions.id, id)).limit(1);
    if (!row) throw new NotFoundException();
    await this.assertManage(user, row.resourceType, row.resourceId);
    await this.perms.revoke(id);
    return { ok: true };
  }
}
