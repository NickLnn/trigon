/**
 * Authorization regression tests (ISO 27001 A.5.15 / A.8.3).
 *
 * 1. Route inventory: every HTTP route is classified (public / admin / editor / authenticated). A new
 *    route, or a changed @Public/@Roles, fails here until it is consciously added to the table.
 * 2. BOLA: every route that takes a document, space, comment, review, version, attachment or permission
 *    id is called as a signed-in user with no access to it. Each must refuse before anything is written,
 *    streamed or sent.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { ForbiddenException, HttpException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ActivityController } from '../activity/activity.controller';
import { AuthController } from '../auth/auth.controller';
import { BackupsController } from '../backups/backups.controller';
import { CommentsController } from '../comments/comments.controller';
import { CommentsService } from '../comments/comments.service';
import { DirectoryController } from '../directory/directory.controller';
import { DocumentsController } from '../documents/documents.controller';
import { TrashController } from '../documents/trash.controller';
import { EmbedsController } from '../embeds/embeds.controller';
import { FilesController } from '../files/files.controller';
import { StorageOverviewController } from '../files/storage-overview.controller';
import { HealthController } from '../health.controller';
import { IconsController } from '../icons/icons.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { PermissionsController } from '../permissions/permissions.controller';
import { ReviewsController } from '../reviews/reviews.controller';
import { SearchSettingsController } from '../search/search-settings.controller';
import { AdminController } from '../settings/admin.controller';
import { SettingsController } from '../settings/settings.controller';
import { SpacesController } from '../spaces/spaces.controller';
import { UsersController } from '../users/users.controller';
import { VersionsController } from '../versions/versions.controller';
import { IS_PUBLIC, ROLES, type AuthUser } from './decorators';

type Ctor = new (...args: never[]) => object;
const CONTROLLERS: Ctor[] = [
  ActivityController, AuthController, BackupsController, CommentsController, DirectoryController, DocumentsController,
  TrashController, EmbedsController, FilesController, StorageOverviewController, HealthController, IconsController,
  NotificationsController, PermissionsController, ReviewsController, SearchSettingsController, AdminController,
  SettingsController, SpacesController, UsersController, VersionsController,
];

type Access = 'public' | 'admin' | 'editor' | 'user';

/** Admin-only areas: every route under these prefixes must require the admin role. */
const ADMIN_PREFIXES = ['activity', 'backups', 'directory', 'settings', 'admin'];
const PUBLIC = new Set([
  'GET auth/config', 'POST auth/register', 'POST auth/login', 'POST auth/ldap', 'GET auth/entra/login',
  'GET auth/entra/callback', 'POST auth/refresh', 'POST auth/logout', 'GET health',
]);
/** Admins and editors only. (User search and icons stay open to viewers by decision; icon fetches go through safeFetch.) */
const EDITOR = new Set(['POST spaces', 'GET embeds/unfurl']);

const join2 = (a: string, b: string) => [a, b].filter((p) => p && p !== '/').join('/').replace(/^\/+|\/+$/g, '');

function routes() {
  const out: { key: string; access: Access; roles: string[] }[] = [];
  for (const ctor of CONTROLLERS) {
    const base = Reflect.getMetadata(PATH_METADATA, ctor) as string;
    for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
      const handler = (ctor.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const isPublic = Reflect.getMetadata(IS_PUBLIC, handler) ?? Reflect.getMetadata(IS_PUBLIC, ctor);
      const roles: string[] = Reflect.getMetadata(ROLES, handler) ?? Reflect.getMetadata(ROLES, ctor) ?? [];
      const access: Access = isPublic ? 'public' : roles.length === 1 && roles[0] === 'admin' ? 'admin' : roles.length ? 'editor' : 'user';
      out.push({ key: `${method} ${join2(base, path)}`, access, roles });
    }
  }
  return out;
}

test('every controller in the codebase is covered by this inventory', () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts') && !f.endsWith('.spec.ts') && /@Controller\(/.test(readFileSync(p, 'utf8'))) {
        found.push(...[...readFileSync(p, 'utf8').matchAll(/export class (\w+Controller)\b/g)].map((m) => m[1]));
      }
    }
  };
  walk(join(__dirname, '..'));
  const listed = CONTROLLERS.map((c) => c.name);
  for (const name of found) assert.ok(listed.includes(name), `${name} is missing from the authorization inventory (${relative(process.cwd(), __filename)})`);
});

test('admin areas require the admin role; only the sign-in routes and health are public', () => {
  const all = routes();
  assert.ok(all.length > 80, `expected the full route list, got ${all.length}`);
  for (const r of all) {
    const prefix = r.key.split(' ')[1].split('/')[0];
    if (ADMIN_PREFIXES.includes(prefix)) assert.equal(r.access, 'admin', `${r.key} must be @Roles('admin')`);
    else if (PUBLIC.has(r.key)) assert.equal(r.access, 'public', `${r.key} should be public`);
    else if (EDITOR.has(r.key)) assert.deepEqual([...r.roles].sort(), ['admin', 'editor'], `${r.key} must be admins and editors only`);
    else assert.equal(r.access, 'user', `${r.key} is ${r.access}: classify it in this test`);
  }
  for (const key of [...PUBLIC, ...EDITOR]) assert.ok(all.some((r) => r.key === key), `${key} no longer exists — update the inventory`);
});

// ─── BOLA ──────────────────────────────────────────────────────────────────────────────────────

const ATTACKER: AuthUser = { id: '00000000-0000-4000-8000-00000000000a', email: 'attacker@example.com', role: 'editor' };
const VICTIM_ID = '00000000-0000-4000-8000-0000000000b0';
const DOC = '00000000-0000-4000-8000-0000000000d0';
const SPACE = '00000000-0000-4000-8000-0000000000e0';

/** A row that satisfies every lookup a handler does before its permission check (a page owned by someone else). */
const ROW = {
  id: DOC, documentId: DOC, spaceId: SPACE, threadId: DOC, resourceType: 'document', resourceId: DOC, subjectType: 'user',
  subjectId: VICTIM_ID, level: 'manage', kind: 'page', title: 'Victim page', storageKey: '0f1e2d3c-4b5a-4978-8a9b-acbdcedf0102',
  mimeType: 'text/plain', sizeBytes: 1, deletedAt: new Date(), status: 'pending', requestedById: VICTIM_ID, reviewerId: VICTIM_ID,
  authorId: VICTIM_ID, ydoc: Buffer.alloc(0), textContent: 'secret', updatedAt: new Date(), createdAt: new Date(),
};

/** Drizzle stand-in: every query resolves to [ROW]; writes are recorded so the test can prove none happened. */
function fakeDb() {
  const writes: string[] = [];
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([ROW]);
        if (prop === 'execute') return async () => ({ rows: [ROW], rowCount: 1 });
        if (prop === 'transaction') return async (fn: (tx: unknown) => unknown) => fn(chain());
        if (prop === 'insert' || prop === 'update' || prop === 'delete') writes.push(String(prop));
        return chain();
      },
      apply: () => chain(),
    });
  return { db: chain() as never, writes };
}

/** No grants anywhere: what the permission service answers for a user with no access. */
const noAccess = {
  assertDocument: async () => {
    throw new ForbiddenException('no access');
  },
  assertSpace: async () => {
    throw new ForbiddenException('no access');
  },
  documentLevel: async () => ({ level: null, spaceId: SPACE }),
  spaceLevel: async () => null,
  spaceLevels: async () => new Map(),
  lineage: async () => ({ spaceId: SPACE, ids: [DOC] }),
  grant: async () => assert.fail('granted access'),
  revoke: async () => assert.fail('revoked access'),
};

/** Any call on these is a side effect that must not happen after a refused request. */
const forbidden = (what: string) =>
  new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : () => assert.fail(`${what}.${String(prop)} was called`)) }) as never;
const quietActivity = { record: () => assert.fail('activity recorded for a refused request'), noteEdit: () => undefined, subjectName: async () => '' } as never;

function controllers() {
  const { db, writes } = fakeDb();
  const perms = noAccess as never;
  const comments = new CommentsService(db, perms, quietActivity, forbidden('notifications'));
  return {
    writes,
    documents: new DocumentsController(db, perms, quietActivity),
    spaces: new SpacesController(db, perms, quietActivity),
    trash: new TrashController(db, perms, forbidden('trash'), quietActivity),
    files: new FilesController(db, perms, forbidden('storage'), quietActivity, forbidden('textIndex')),
    comments: new CommentsController(comments),
    reviews: new ReviewsController(db, perms, quietActivity, forbidden('notifications'), comments),
    versions: new VersionsController(db, forbidden('versions'), forbidden('collab'), quietActivity, perms),
    permissions: new PermissionsController(perms, db, quietActivity, forbidden('notifications')),
  };
}

const refused = (e: unknown) => e instanceof ForbiddenException || e instanceof NotFoundException || (e instanceof HttpException && e.getStatus() === 403);
const fakeRes = { set: () => undefined } as never;
const file = { buffer: Buffer.from('x'), originalname: 'x.png', mimetype: 'image/png', size: 1 } as never;

test('object-level routes refuse a user without access to that id, before writing anything', async () => {
  const c = controllers();
  const attempts: [string, () => Promise<unknown>][] = [
    ['GET documents/:id', () => c.documents.get(ATTACKER, DOC)],
    ['PATCH documents/:id', () => c.documents.update(ATTACKER, DOC, { title: 'pwned' } as never)],
    ['PATCH documents/:id (move into victim folder)', () => c.documents.update(ATTACKER, DOC, { parentId: DOC } as never)],
    ['PUT documents/:id/import-html', () => c.documents.setImportHtml(ATTACKER, DOC, { html: '<p>x</p>' })],
    ['POST documents/:id/verify', () => c.documents.verify(ATTACKER, DOC)],
    ['DELETE documents/:id', () => c.documents.remove(ATTACKER, DOC)],
    ['POST documents (in victim space)', () => c.documents.create(ATTACKER, { spaceId: SPACE, kind: 'page' } as never)],
    ['POST documents (under victim folder)', () => c.documents.create(ATTACKER, { spaceId: SPACE, parentId: DOC, kind: 'page' } as never)],
    ['POST documents/import', () => c.documents.import(ATTACKER, { spaceId: SPACE, title: 't', html: '' } as never)],
    ['GET spaces/:id', () => c.spaces.get(ATTACKER, SPACE)],
    ['PATCH spaces/:id', () => c.spaces.update(ATTACKER, SPACE, { name: 'pwned' })],
    ['DELETE spaces/:id', () => c.spaces.remove(ATTACKER, SPACE)],
    ['GET spaces/:id/stats', () => c.spaces.stats(ATTACKER, SPACE)],
    ['GET spaces/:id/tree', () => c.spaces.tree(ATTACKER, SPACE)],
    ['GET spaces/:id/trash', () => c.trash.list(ATTACKER, SPACE)],
    ['POST documents/:id/restore', () => c.trash.restore(ATTACKER, DOC)],
    ['DELETE documents/:id/permanent', () => c.trash.purge(ATTACKER, DOC)],
    ['POST files', () => c.files.upload(ATTACKER, { spaceId: SPACE }, file)],
    ['GET files/:id/content', () => c.files.content(ATTACKER, DOC, fakeRes)],
    ['PUT files/:id/content', () => c.files.saveText(ATTACKER, DOC, { content: 'x' })],
    ['POST files/attachments', () => c.files.uploadAttachment(ATTACKER, DOC, file)],
    ['POST files/attachments/import', () => c.files.importImage(ATTACKER, { documentId: DOC, url: 'https://example.com/a.png' })],
    ['GET files/attachments/:id', () => c.files.attachment(ATTACKER, DOC, fakeRes)],
    ['GET documents/:id/comments', () => c.comments.list(ATTACKER, DOC)],
    ['POST documents/:id/comments', () => c.comments.create(ATTACKER, DOC, { body: 'hi' })],
    ['POST comment-threads/:id/replies', () => c.comments.reply(ATTACKER, DOC, { body: 'hi' })],
    ['PATCH comment-threads/:id', () => c.comments.resolve(ATTACKER, DOC, { resolved: true })],
    ['PATCH comments/:id', () => c.comments.edit(ATTACKER, DOC, { body: 'hi' })],
    ['DELETE comments/:id', () => c.comments.remove(ATTACKER, DOC)],
    ['GET documents/:id/review-requests', () => c.reviews.forDocument(ATTACKER, DOC)],
    ['POST documents/:id/review-requests', () => c.reviews.ask(ATTACKER, DOC, { reviewerId: VICTIM_ID } as never)],
    ['POST review-requests/:id/approve', () => c.reviews.approve(ATTACKER, DOC, {})],
    ['POST review-requests/:id/request-changes', () => c.reviews.requestChanges(ATTACKER, DOC, { note: 'x' })],
    ['POST review-requests/:id/cancel', () => c.reviews.cancel(ATTACKER, DOC)],
    ['GET documents/:id/versions', () => c.versions.list(ATTACKER, DOC)],
    ['GET documents/:id/versions/:versionId', () => c.versions.get(ATTACKER, DOC, DOC)],
    ['POST documents/:id/versions/:versionId/restore', () => c.versions.restore(ATTACKER, DOC, DOC)],
    ['GET permissions/effective/:type/:id', () => c.permissions.effective(ATTACKER, 'document', DOC)],
    ['GET permissions/:type/:id', () => c.permissions.list(ATTACKER, 'space', SPACE)],
    ['POST permissions (grant self manage)', () => c.permissions.grant(ATTACKER, { resourceType: 'space', resourceId: SPACE, subjectType: 'user', subjectId: ATTACKER.id, level: 'manage' })],
    ['DELETE permissions/:id', () => c.permissions.revoke(ATTACKER, DOC)],
  ];
  for (const [route, call] of attempts) {
    await assert.rejects(call(), refused, `${route} was not refused`);
  }
  assert.deepEqual(c.writes, [], 'a refused request wrote to the database');
});

test('lists only show what the user can see (nothing, without grants)', async () => {
  const c = controllers();
  assert.deepEqual(await c.documents.search(ATTACKER, { q: 'secret' }), []);
  assert.deepEqual(await c.documents.recent(ATTACKER), []);
  assert.equal((await c.documents.health(ATTACKER)).total, 0);
  assert.deepEqual(await c.spaces.list(ATTACKER), []);
  assert.deepEqual(await c.trash.all(ATTACKER), []);
  assert.deepEqual(c.writes, []);
});
