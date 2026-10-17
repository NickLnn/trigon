import type { NotificationPrefs } from '@trigon/shared';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const authProvider = pgEnum('auth_provider', ['local', 'entra', 'ldap']);
export const groupSource = pgEnum('group_source', ['local', 'entra', 'ldap']);
export const systemRole = pgEnum('system_role', ['admin', 'editor', 'viewer']);
export const permissionLevel = pgEnum('permission_level', ['view', 'comment', 'edit', 'manage']);
export const documentKind = pgEnum('document_kind', ['folder', 'page', 'file']);
export const pageType = pgEnum('page_type', ['page', 'runbook', 'kb']);
export const docStatus = pgEnum('doc_status', ['none', 'draft', 'verified']);
export const resourceType = pgEnum('resource_type', ['space', 'document']);
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'changes_requested', 'cancelled']);
export const spaceSort = pgEnum('space_sort', ['alpha', 'manual']);
export const subjectType = pgEnum('subject_type', ['user', 'group', 'everyone']);

/**
 * The unified identity. A person is one User no matter how many ways they can sign in;
 * each sign-in method is an Account row linked to it.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    jobTitle: text('job_title'),
    department: text('department'),
    role: systemRole('role').notNull().default('editor'),
    /** False when the directory reports the account as disabled/removed. */
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Email notification choices (Profile → Notifications); missing keys use the defaults. */
    notificationPrefs: jsonb('notification_prefs').$type<Partial<NotificationPrefs>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider('provider').notNull(),
    /** Entra object id, LDAP objectGUID/DN, or the lower-cased email for local accounts. */
    providerAccountId: text('provider_account_id').notNull(),
    /** argon2id hash — local accounts only. */
    passwordHash: text('password_hash'),
    /** Raw directory attributes from the last sync, for debugging and future mapping. */
    profile: jsonb('profile').$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('accounts_provider_uq').on(t.provider, t.providerAccountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the opaque token; the raw value only ever lives in the httpOnly cookie. */
    tokenHash: text('token_hash').notNull(),
    /** Rotation family — reuse of a revoked token revokes the whole family. */
    familyId: uuid('family_id').notNull(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_family_idx').on(t.familyId)],
);

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    source: groupSource('source').notNull().default('local'),
    /** Entra group object id or LDAP DN; null for local groups. */
    externalId: text('external_id'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('groups_source_external_uq').on(t.source, t.externalId)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('group_members_user_idx').on(t.userId)],
);

export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    sortMode: spaceSort('sort_mode').notNull().default('alpha'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('spaces_slug_uq').on(t.slug)],
);

/**
 * Folders, pages and uploaded files all live in one tree per space.
 * Pages store their collaborative state as a Yjs update (ydoc) plus a JSON snapshot
 * (content) and plain text (used for search and embeddings).
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => documents.id, { onDelete: 'cascade' }),
    kind: documentKind('kind').notNull().default('page'),
    title: text('title').notNull().default('Untitled'),
    icon: text('icon'),
    position: doublePrecision('position').notNull().default(0),
    ydoc: bytea('ydoc'),
    content: jsonb('content').$type<Record<string, unknown>>(),
    textContent: text('text_content'),
    /** For kind = 'file': stored blob metadata. */
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    storageKey: text('storage_key'),
    /** For kind = 'file': when text was last read out of the blob (null = waiting for the indexer). */
    textIndexedAt: timestamp('text_indexed_at', { withTimezone: true }),
    /** How that text was obtained: text | ocr | empty | unsupported | failed. */
    textSource: text('text_source'),
    pageType: pageType('page_type').notNull().default('page'),
    /** Review workflow: draft → verified; becomes "stale" once verifiedAt + reviewIntervalDays passes. */
    status: docStatus('status').notNull().default('none'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedById: uuid('verified_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Null = workspace default (180 days). */
    reviewIntervalDays: integer('review_interval_days'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Product / version tags, e.g. "ESXi 8", "Windows Server 2022". */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** Sanitised HTML from a Markdown/HTML import; seeds the Yjs doc on first open, then cleared. */
    importHtml: text('import_html'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedById: uuid('deleted_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('documents_space_parent_idx').on(t.spaceId, t.parentId, t.position),
    // trigon_fold() (created in migration 0010) drops accents and folds ς→σ, so "Αθηνα" finds "ΑΘΉΝΑ".
    index('documents_search_idx').using(
      'gin',
      sql`to_tsvector('simple', trigon_fold(coalesce(${t.title}, '') || ' ' || coalesce(${t.textContent}, '')))`,
    ),
    index('documents_text_pending_idx').on(t.createdAt).where(sql`${t.kind} = 'file' and ${t.textIndexedAt} is null`),
  ],
);

/** Inline media (images pasted or clipped into a page). Access follows the owning document. */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sourceUrl: text('source_url'),
    /** Text read from the image by OCR, so a page is found by the words in its screenshots. */
    textContent: text('text_content'),
    /** When the image was last read (null = waiting for the indexer). */
    textIndexedAt: timestamp('text_indexed_at', { withTimezone: true }),
    /** ocr | empty | unsupported | failed */
    textSource: text('text_source'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_document_idx').on(t.documentId),
    index('attachments_search_idx').using('gin', sql`to_tsvector('simple', trigon_fold(coalesce(${t.textContent}, '')))`),
    index('attachments_text_pending_idx').on(t.createdAt).where(sql`${t.textIndexedAt} is null`),
  ],
);

/**
 * A grant of `level` on a space or document to a user, a group, or everyone signed in.
 * Effective permission = strongest grant found on the resource or any ancestor (incl. the space).
 */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceType: resourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    subjectType: subjectType('subject_type').notNull(),
    /** User or group id; null when subjectType = 'everyone'. */
    subjectId: uuid('subject_id'),
    level: permissionLevel('level').notNull(),
    grantedById: uuid('granted_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('permissions_grant_uq')
      .on(t.resourceType, t.resourceId, t.subjectType, t.subjectId)
      .nullsNotDistinct(),
    index('permissions_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

/** Chunked semantic embeddings for documents (pgvector). Dimension matches common 1536-d models. */
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    model: text('model').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('embeddings_doc_chunk_uq').on(t.documentId, t.chunkIndex),
    index('embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/**
 * Custom icons for spaces, folders and pages: original vendor favicons fetched from a domain
 * (microsoft.com, vmware.com…) or images uploaded by users. Referenced as `img:<id>` in `icon` columns.
 */
export const icons = pgTable(
  'icons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Source domain for fetched favicons; null for uploads. */
    domain: text('domain'),
    /** Where the image was downloaded from (a pinned catalog logo is re-fetched when this changes). */
    sourceUrl: text('source_url'),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('icons_domain_uq').on(t.domain)],
);

/**
 * Admin-editable configuration (auth, Entra, LDAP…), one JSON document per section.
 * Secrets inside are encrypted by SettingsService before they reach this table.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Page history. A version is the page at the end of one person's editing session (saves within 30
 * minutes by the same person extend it), so restoring goes back to a meaningful point, not a keystroke.
 */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    ydoc: bytea('ydoc').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>(),
    textContent: text('text_content').notNull().default(''),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('document_versions_document_idx').on(t.documentId, t.updatedAt)],
);

/** "Ask for review": one person asks another to check a page or file; the reviewer approves or asks for changes. */
export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: reviewStatus('status').notNull().default('pending'),
    message: text('message'),
    response: text('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [index('review_requests_reviewer_idx').on(t.reviewerId, t.status), index('review_requests_document_idx').on(t.documentId, t.status)],
);

/**
 * Audit log for the Activity explorer. Names are copied at write time so the history stays readable
 * after people, spaces or pages are renamed or deleted (hence no foreign keys except the actor).
 */
export const activity = pgTable(
  'activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: text('actor_name'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    category: text('category').notNull(),
    spaceId: uuid('space_id'),
    spaceName: text('space_name'),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    targetName: text('target_name'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('activity_at_idx').on(t.at),
    index('activity_actor_idx').on(t.actorId, t.at),
    index('activity_space_idx').on(t.spaceId, t.at),
    index('activity_target_idx').on(t.targetId, t.at),
    index('activity_category_idx').on(t.category, t.at),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  memberships: many(groupMembers),
}));
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));
export const groupsRelations = relations(groups, ({ many }) => ({ members: many(groupMembers) }));
export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));
export const spacesRelations = relations(spaces, ({ many }) => ({ documents: many(documents) }));
export const documentsRelations = relations(documents, ({ one, many }) => ({
  space: one(spaces, { fields: [documents.spaceId], references: [spaces.id] }),
  parent: one(documents, { fields: [documents.parentId], references: [documents.id], relationName: 'tree' }),
  children: many(documents, { relationName: 'tree' }),
  embeddings: many(embeddings),
}));
export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  document: one(documents, { fields: [embeddings.documentId], references: [documents.id] }),
}));

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
