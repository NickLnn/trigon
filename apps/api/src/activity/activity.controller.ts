import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ACTIVITY_ACTIONS, ACTIVITY_CATEGORIES, activityLabel, type ActivityEvent, type ActivityPage } from '@trigon/shared';
import { and, desc, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { Roles } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { activity } from '../db/schema';

export interface ActivityQuery {
  q?: string;
  /** Comma-separated lists. */
  actor?: string;
  action?: string;
  category?: string;
  space?: string;
  target?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const uuids = (v: string | undefined) => {
  const ids = list(v);
  if (ids.some((id) => !UUID.test(id))) throw new BadRequestException('Invalid id');
  return ids;
};
const date = (v: string | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${v}`);
  return d;
};

/** Build the WHERE clause shared by the list and the CSV export. Exported for tests. */
export function activityFilter(query: ActivityQuery): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  const actors = uuids(query.actor);
  if (actors.length) conds.push(inArray(activity.actorId, actors));
  const spacesFilter = uuids(query.space);
  if (spacesFilter.length) conds.push(inArray(activity.spaceId, spacesFilter));
  const targets = uuids(query.target);
  if (targets.length) conds.push(inArray(activity.targetId, targets));
  const actions = list(query.action).filter((a) => a in ACTIVITY_ACTIONS);
  if (actions.length) conds.push(inArray(activity.action, actions));
  const categories = list(query.category).filter((c) => (ACTIVITY_CATEGORIES as readonly string[]).includes(c));
  if (categories.length) conds.push(inArray(activity.category, categories));
  const from = date(query.from);
  if (from) conds.push(gte(activity.at, from));
  const to = date(query.to);
  if (to) conds.push(lte(activity.at, to));

  const q = (query.q ?? '').trim().slice(0, 200);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    // "shared", "deleted"… match the readable activity names too.
    const lower = q.toLowerCase();
    const named = Object.keys(ACTIVITY_ACTIONS).filter((a) =>
      ['page', 'folder', 'file', 'space', 'item'].some((t) => activityLabel(a, t).toLowerCase().includes(lower)),
    );
    conds.push(
      or(
        ilike(activity.actorName, like),
        ilike(activity.actorEmail, like),
        ilike(activity.targetName, like),
        ilike(activity.spaceName, like),
        ilike(activity.ip, like),
        sql`${activity.details}::text ILIKE ${like}`,
        named.length ? inArray(activity.action, named) : undefined,
      ),
    );
  }
  return and(...conds);
}

const encodeCursor = (e: { at: Date; id: string }) => Buffer.from(`${e.at.toISOString()}|${e.id}`).toString('base64url');
function decodeCursor(c: string) {
  const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
  if (!at || !UUID.test(id ?? '') || Number.isNaN(new Date(at).getTime())) throw new BadRequestException('Invalid cursor');
  return { at: new Date(at), id };
}

type Row = typeof activity.$inferSelect;
const toEvent = (r: Row): ActivityEvent => ({ ...r, at: r.at.toISOString() }) as ActivityEvent;

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Activity explorer: everything people did, newest first. Administrators only. */
@Controller('activity')
@Roles('admin')
export class ActivityController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get()
  async list(@Query() query: ActivityQuery): Promise<ActivityPage> {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db
      .select()
      .from(activity)
      .where(
        and(
          activityFilter(query),
          cursor ? sql`(${activity.at}, ${activity.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(activity.at), desc(activity.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items: items.map(toEvent), nextCursor: more ? encodeCursor(items[items.length - 1]) : null };
  }

  /** Everyone who appears in the log (including since-deleted users), for the "User" filter. */
  @Get('actors')
  async actors() {
    return this.db
      .select({ id: activity.actorId, name: sql<string>`max(${activity.actorName})`, email: sql<string>`max(${activity.actorEmail})` })
      .from(activity)
      .where(isNotNull(activity.actorId))
      .groupBy(activity.actorId)
      .orderBy(sql`max(${activity.actorName})`)
      .limit(1000);
  }

  /** The filtered log as CSV (up to 50,000 rows). */
  @Get('export')
  async export(@Query() query: ActivityQuery, @Res() res: Response) {
    const rows = await this.db
      .select()
      .from(activity)
      .where(activityFilter(query))
      .orderBy(desc(activity.at), desc(activity.id))
      .limit(50_000);
    const header = ['Time (UTC)', 'User', 'Email', 'Activity', 'Item type', 'Item', 'Space', 'Details', 'IP address', 'User agent'];
    const lines = rows.map((r) =>
      [r.at.toISOString(), r.actorName, r.actorEmail, activityLabel(r.action, r.targetType), r.targetType, r.targetName, r.spaceName, r.details, r.ip, r.userAgent]
        .map(csvCell)
        .join(','),
    );
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="trigon-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.send('﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n'));
  }
}
