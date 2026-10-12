import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { atLeast, type MyReviewRequest, type ReviewRequest } from '@trigon/shared';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, reviewRequests, spaces, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';

class AskDto {
  @IsUUID() reviewerId: string;
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
  /** The reviewer can't edit the item yet: give them edit access (needs 'manage' on it). */
  @IsOptional() @IsBoolean() shareAccess?: boolean;
}

class AnswerDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class ChangesDto {
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
}

const requester = alias(users, 'requester');
const reviewer = alias(users, 'reviewer');

const columns = {
  id: reviewRequests.id,
  documentId: reviewRequests.documentId,
  status: reviewRequests.status,
  message: reviewRequests.message,
  response: reviewRequests.response,
  createdAt: reviewRequests.createdAt,
  respondedAt: reviewRequests.respondedAt,
  requestedById: reviewRequests.requestedById,
  requestedByName: requester.displayName,
  reviewerId: reviewRequests.reviewerId,
  reviewerName: reviewer.displayName,
  reviewerEmail: reviewer.email,
};

type Row = {
  id: string;
  documentId: string;
  status: ReviewRequest['status'];
  message: string | null;
  response: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  requestedById: string | null;
  requestedByName: string | null;
  reviewerId: string;
  reviewerName: string;
  reviewerEmail: string;
};

const toRequest = (r: Row): ReviewRequest => ({
  id: r.id,
  documentId: r.documentId,
  status: r.status,
  message: r.message,
  response: r.response,
  createdAt: r.createdAt.toISOString(),
  respondedAt: r.respondedAt?.toISOString() ?? null,
  requestedBy: r.requestedById ? { id: r.requestedById, name: r.requestedByName ?? 'Unknown' } : null,
  reviewer: { id: r.reviewerId, name: r.reviewerName, email: r.reviewerEmail },
});

/**
 * "Ask for review": anyone who can edit a page or file asks a colleague to check it. The reviewer needs
 * edit access — they may fix things themselves — and approves (the item becomes verified, in their name)
 * or asks for changes (it goes back to draft). Both sides are emailed and everything lands in the
 * activity log.
 */
@Controller()
export class ReviewsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly perms: PermissionsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  private base() {
    return this.db
      .select(columns)
      .from(reviewRequests)
      .leftJoin(requester, eq(requester.id, reviewRequests.requestedById))
      .innerJoin(reviewer, eq(reviewer.id, reviewRequests.reviewerId));
  }

  /** Pending requests on an item plus the five latest answers. */
  @Get('documents/:id/review-requests')
  async forDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReviewRequest[]> {
    await this.perms.assertDocument(user, id, 'view');
    const rows = (await this.base()
      .where(and(eq(reviewRequests.documentId, id), inArray(reviewRequests.status, ['pending', 'approved', 'changes_requested'])))
      .orderBy(desc(reviewRequests.createdAt))
      .limit(30)) as Row[];
    const pending = rows.filter((r) => r.status === 'pending');
    const answered = rows.filter((r) => r.status !== 'pending').slice(0, 5);
    return [...pending, ...answered].map(toRequest);
  }

  @Post('documents/:id/review-requests')
  async ask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AskDto): Promise<ReviewRequest> {
    const { level: myLevel, spaceId } = await this.perms.assertDocument(user, id, 'edit');
    const [doc] = await this.db.select({ title: documents.title, kind: documents.kind }).from(documents).where(eq(documents.id, id));
    if (doc.kind === 'folder') throw new BadRequestException('Folders can’t be reviewed — ask for a review of a page or file.');
    if (dto.reviewerId === user.id) throw new BadRequestException('Ask someone else to review it.');
    const [person] = await this.db.select().from(users).where(eq(users.id, dto.reviewerId));
    if (!person || !person.active) throw new NotFoundException('That person is not an active Trigon user.');

    const { level } = await this.perms.documentLevel({ id: person.id, email: person.email, role: person.role }, id);
    if (!atLeast(level, 'edit')) {
      const name = person.displayName;
      const now = !level ? `can’t open this ${doc.kind}` : `can only ${level === 'comment' ? 'view and comment on' : 'view'} this ${doc.kind}`;
      // The Viewer role is read-only everywhere, so no share can fix it — only an admin changing the role.
      if (person.role === 'viewer') {
        throw new ConflictException({
          code: 'no_access',
          canShare: false,
          message: `${name} ${now}. Reviewers need edit access to make changes, and ${name} has the Viewer role in Trigon, which is read-only everywhere. An administrator must change their role to Editor first (Settings → Users).`,
        });
      }
      const canShare = atLeast(myLevel, 'manage');
      if (!dto.shareAccess || !canShare) {
        throw new ConflictException({
          code: 'no_access',
          canShare,
          message: canShare
            ? `${name} ${now}. To review it and make changes they need edit access.`
            : `${name} ${now}. To review it and make changes they need edit access — ask someone who manages this ${doc.kind} to give it to them, then send the request again.`,
        });
      }
      const previous = level;
      await this.perms.grant({ resourceType: 'document', resourceId: id, subjectType: 'user', subjectId: person.id, level: 'edit', grantedById: user.id });
      this.activity.record({
        action: previous ? 'share.changed' : 'share.added',
        actorId: user.id,
        spaceId,
        target: { type: doc.kind, id, name: doc.title },
        details: {
          sharedWith: `${person.displayName} (${person.email})`,
          sharedWithType: 'user',
          sharedWithId: person.id,
          level: 'edit',
          ...(previous ? { previousLevel: previous } : {}),
          reason: 'Review request',
        },
      });
    }

    const [open] = await this.db
      .select({ id: reviewRequests.id })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.documentId, id), eq(reviewRequests.reviewerId, person.id), eq(reviewRequests.status, 'pending')));
    if (open) throw new ConflictException({ code: 'already_asked', message: `${person.displayName} already has a pending review of this ${doc.kind}.` });

    const message = dto.message?.trim() || null;
    const [created] = await this.db
      .insert(reviewRequests)
      .values({ documentId: id, requestedById: user.id, reviewerId: person.id, message })
      .returning({ id: reviewRequests.id });
    this.activity.record({
      action: 'review.requested',
      actorId: user.id,
      spaceId,
      target: { type: doc.kind, id, name: doc.title },
      details: { reviewer: `${person.displayName} (${person.email})`, ...(message ? { message } : {}) },
    });
    this.notifications.reviewRequested({ requestId: created.id, requesterId: user.id, reviewerId: person.id, documentId: id, message });
    const [row] = (await this.base().where(eq(reviewRequests.id, created.id))) as Row[];
    return toRequest(row);
  }

  /** Pending requests addressed to me (home page, Review list, sidebar badge). */
  @Get('review-requests/mine')
  async mine(@CurrentUser() user: AuthUser): Promise<MyReviewRequest[]> {
    const rows = await this.db
      .select({
        ...columns,
        title: documents.title,
        kind: documents.kind,
        icon: documents.icon,
        mimeType: documents.mimeType,
        pageType: documents.pageType,
        spaceId: documents.spaceId,
        spaceName: spaces.name,
      })
      .from(reviewRequests)
      .leftJoin(requester, eq(requester.id, reviewRequests.requestedById))
      .innerJoin(reviewer, eq(reviewer.id, reviewRequests.reviewerId))
      .innerJoin(documents, eq(documents.id, reviewRequests.documentId))
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(and(eq(reviewRequests.reviewerId, user.id), eq(reviewRequests.status, 'pending'), isNull(documents.deletedAt)))
      .orderBy(reviewRequests.createdAt)
      .limit(200);
    return rows.map((r) => ({
      ...toRequest(r as Row),
      document: { title: r.title, kind: r.kind, icon: r.icon, mimeType: r.mimeType, pageType: r.pageType, spaceId: r.spaceId, spaceName: r.spaceName },
    }));
  }

  private async pendingFor(user: AuthUser, id: string) {
    const [req] = await this.db.select().from(reviewRequests).where(eq(reviewRequests.id, id));
    if (!req) throw new NotFoundException();
    if (req.status !== 'pending') throw new ConflictException('This review request has already been answered or cancelled.');
    return req;
  }

  /** Reviewers must (still) be able to edit — access may have changed since they were asked. */
  private async reviewerAccess(user: AuthUser, documentId: string) {
    const { level, spaceId } = await this.perms.documentLevel(user, documentId);
    if (!atLeast(level, 'edit')) {
      throw new ForbiddenException('You need edit access to review this. Ask the person who requested the review, or whoever manages it, to give you edit access.');
    }
    return { spaceId };
  }

  /** The reviewer approves: the item becomes verified in their name. */
  @Post('review-requests/:id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    const req = await this.pendingFor(user, id);
    if (req.reviewerId !== user.id) throw new ForbiddenException('Only the person asked can approve this review.');
    const { spaceId } = await this.reviewerAccess(user, req.documentId);
    const note = dto.note?.trim() || null;
    const [doc] = await this.db
      .update(documents)
      .set({ status: 'verified', verifiedAt: new Date(), verifiedById: user.id })
      .where(eq(documents.id, req.documentId))
      .returning({ title: documents.title, kind: documents.kind });
    await this.db.update(reviewRequests).set({ status: 'approved', response: note, respondedAt: new Date() }).where(eq(reviewRequests.id, id));
    this.activity.record({
      action: 'review.approved',
      actorId: user.id,
      spaceId,
      target: { type: doc.kind, id: req.documentId, name: doc.title },
      details: note ? { note } : {},
    });
    this.notifications.reviewAnswered({ requesterId: req.requestedById, reviewerId: user.id, documentId: req.documentId, approved: true, note });
    return { ok: true };
  }

  /** The reviewer asks for changes: the item goes back to draft. */
  @Post('review-requests/:id/request-changes')
  async requestChanges(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangesDto) {
    const req = await this.pendingFor(user, id);
    if (req.reviewerId !== user.id) throw new ForbiddenException('Only the person asked can answer this review.');
    const { spaceId } = await this.reviewerAccess(user, req.documentId);
    const note = dto.note.trim();
    const [doc] = await this.db
      .update(documents)
      .set({ status: 'draft' })
      .where(eq(documents.id, req.documentId))
      .returning({ title: documents.title, kind: documents.kind });
    await this.db.update(reviewRequests).set({ status: 'changes_requested', response: note, respondedAt: new Date() }).where(eq(reviewRequests.id, id));
    this.activity.record({
      action: 'review.changes_requested',
      actorId: user.id,
      spaceId,
      target: { type: doc.kind, id: req.documentId, name: doc.title },
      details: { note },
    });
    this.notifications.reviewAnswered({ requesterId: req.requestedById, reviewerId: user.id, documentId: req.documentId, approved: false, note });
    return { ok: true };
  }

  /** Withdraw a request: whoever asked, or anyone who manages the item. */
  @Post('review-requests/:id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const req = await this.pendingFor(user, id);
    const { level, spaceId } = await this.perms.documentLevel(user, req.documentId);
    if (req.requestedById !== user.id && !atLeast(level, 'manage')) throw new ForbiddenException('Only the person who asked can cancel this review.');
    await this.db.update(reviewRequests).set({ status: 'cancelled', respondedAt: new Date() }).where(eq(reviewRequests.id, id));
    const [doc] = await this.db.select({ title: documents.title, kind: documents.kind }).from(documents).where(eq(documents.id, req.documentId));
    const [person] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, req.reviewerId));
    this.activity.record({
      action: 'review.cancelled',
      actorId: user.id,
      spaceId,
      target: { type: doc?.kind ?? 'page', id: req.documentId, name: doc?.title ?? null },
      details: { reviewer: person?.name ?? 'Unknown' },
    });
    return { ok: true };
  }
}
