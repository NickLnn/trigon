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
export const systemRole = pgEnum('system_role', ['admin', 'member', 'guest']);
export const permissionLevel = pgEnum('permission_level', ['view', 'comment', 'edit', 'manage']);
export const documentKind = pgEnum('document_kind', ['folder', 'page', 'file']);
export const resourceType = pgEnum('resource_type', ['space', 'document']);
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
    role: systemRole('role').notNull().default('member'),
    /** False when the directory reports the account as disabled/removed. */
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
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
    /** Sanitised HTML from a Markdown/HTML import; seeds the Yjs doc on first open, then cleared. */
    importHtml: text('import_html'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('documents_space_parent_idx').on(t.spaceId, t.parentId, t.position),
    index('documents_search_idx').using(
      'gin',
      sql`to_tsvector('simple', coalesce(${t.title}, '') || ' ' || coalesce(${t.textContent}, ''))`,
    ),
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
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachments_document_idx').on(t.documentId)],
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
