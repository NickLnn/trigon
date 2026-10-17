import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { COMMENT_MAX, type CommentsResponse } from '@trigon/shared';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { CommentsService } from './comments.service';

/** Encoded Yjs relative positions are a few dozen bytes; base64 only. */
const ANCHOR = /^[A-Za-z0-9+/]{4,600}={0,2}$/;

class BodyDto {
  @IsString() @MaxLength(COMMENT_MAX + 1000) body: string;
}

class NewThreadDto extends BodyDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Matches(ANCHOR) anchorFrom?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Matches(ANCHOR) anchorTo?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(2000) quote?: string | null;
}

class ResolveDto {
  @IsBoolean() resolved: boolean;
}

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('documents/:id/comments')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CommentsResponse> {
    return this.comments.list(user, id);
  }

  @Post('documents/:id/comments')
  async create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewThreadDto) {
    return { id: await this.comments.createThread(user, id, dto) };
  }

  @Post('comment-threads/:id/replies')
  async reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BodyDto) {
    await this.comments.reply(user, id, dto.body);
    return { ok: true };
  }

  @Patch('comment-threads/:id')
  async resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto) {
    await this.comments.setResolved(user, id, dto.resolved);
    return { ok: true };
  }

  @Patch('comments/:id')
  async edit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BodyDto) {
    await this.comments.edit(user, id, dto.body);
    return { ok: true };
  }

  @Delete('comments/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.comments.remove(user, id);
    return { ok: true };
  }
}
