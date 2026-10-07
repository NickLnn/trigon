<p align="center"><img src="apps/web/public/brand/trigon-lockup.jpg" alt="Trigon — Collaborative workspace" width="420"></p>

# Trigon

Open-source collaborative knowledge platform — a hybrid of Docmost, Notion and SharePoint — with a
mobile-first, installable PWA front end inspired by modern fintech apps.

- **Sign in** with email/password, **Microsoft Entra ID** (OIDC) or **LDAP / Active Directory** — all mapped onto one user.
- **Directory sync** pulls users, security groups and memberships from Microsoft Graph and LDAP on a schedule.
- **Spaces → folders → pages / files**, with **inherited RBAC** granted to users, synced groups or everyone.
- **Real-time editor** (Tiptap + Yjs CRDT over WebSockets) with **automatic code detection** on paste,
  a **web clipper** that cleans pasted web pages and re-hosts their images, and **YouTube / Vimeo / Loom / link-card embeds**.
- **"/" command menu** in pages (headings, lists, to-dos, quotes, code blocks, tables, dividers, images, embeds).
- **In-app viewers** for **PDF** (page jump, zoom, text selection, search), **Word**, **Excel** and **PowerPoint**.
- **Editable text & code files** — YAML, JSON, PowerShell, Bash, Python, configs… open in a code editor with highlighting.
- **Custom icons** for spaces, folders and pages: original vendor logos (Microsoft, VMware, Red Hat… or any website), uploads or emoji.
- **Admin settings** for Microsoft Entra ID (incl. one-click app registration), LDAP/AD, users and groups.
- **PWA**: installable on iOS and Android, standalone (no URL bar), offline fallback and cached navigation.

## Repository layout

```
apps/
  api/        NestJS 11 · Drizzle ORM · Passport (local, LDAP, JWT) · MSAL (Entra) · Hocuspocus (Yjs)
  web/        Next.js 16 (App Router) · Tailwind CSS 4 · Serwist (service worker) · Tiptap 3
packages/
  shared/     Types and helpers used by both (permission levels, embed URL matching, …)
docker/       Postgres init script (enables pgvector)
docker-compose.yml   Postgres 17 + pgvector, Redis 7, api, web
```

## Branches

| Branch | Purpose |
| ------ | ------- |
| `main` | Stable — only code that has been tested and works. This is what everyone runs. |
| `dev`  | Active development — may be broken. Work happens here, then merges into `main`. |

Typical flow: commit to `dev` (or a short-lived feature branch off `dev`) → verify → open a PR `dev → main`.

## Running it

### Option A — everything in Docker (e.g. on the NAS)

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD, JWT_ACCESS_SECRET, APP_URL
# Synology/Xpenology Docker does not create bind-mount folders itself; the API runs as uid 1000.
mkdir -p data/postgres data/redis data/storage && chown 1000:1000 data/storage
docker compose up -d --build
```

If a host port is already taken (DSM often uses 5432), change `POSTGRES_PORT` / `REDIS_PORT` / `WEB_PORT` in `.env` —
containers talk to each other over the internal Docker network, so only the published port changes.

Web on `:3000`, API on `:4000`, collaboration WebSocket on `:4001`. Database migrations run automatically
when the API container starts. The first account you register becomes the admin.

> **HTTPS is required for the PWA.** Browsers only enable service workers (install to home screen,
> offline mode) on `https://` or `localhost`, and Microsoft Entra only accepts HTTPS redirect URIs.
> On Synology DSM, put a reverse-proxy rule with a Let's Encrypt certificate in front of port 3000
> (and 4001 for WebSockets, or route `/collab` to it and set `NEXT_PUBLIC_COLLAB_URL=wss://<host>/collab`),
> then set `APP_URL=https://…` and `COOKIE_SECURE=true`.

### Option B — local development

Requires Node 22+ and Docker (for Postgres + Redis).

```bash
cp .env.example .env        # set JWT_ACCESS_SECRET; defaults point at localhost
npm install
docker compose up -d postgres redis
npm run db:migrate
npm run dev                 # api on :4000 (+ ws :4001), web on :3000
```

> **Windows + network share:** npm workspaces need directory junctions, which Windows cannot create on an
> SMB share. Run `npm install` / `npm run dev` from a clone on a local disk (e.g. `C:\dev\trigon`);
> the copy on the NAS share is for Docker builds.

### Useful scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | API + web in watch mode |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Unit tests (code detection, embed matching, …) |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run icons -w @trigon/web` | Rebuild logo, app icons and favicon from `apps/web/brand-src/trigon-logo-original.png` |

## File support

| Type | In Trigon |
| ---- | --------- |
| Pages | Real-time collaborative editing |
| Text & code (.txt, .md, .yaml, .json, .ps1, .sh, .py, .conf, …) | **Editable** in the built-in code editor |
| PDF | Viewer with search, zoom, page jump |
| Word (.docx), Excel (.xlsx), PowerPoint (.pptx) | **Read-only** preview in the browser — download to edit |
| Visio (.vsdx) | Download only (no browser preview yet) |
| Images | Inline preview |
| Anything else | Stored and downloadable |

> **Why Office files are read-only:** in-browser editing of Word/Excel/PowerPoint needs an office
> server such as OnlyOffice Docs or Collabora, which wants 2–4 GB of RAM on its own. Trigon stays
> lightweight on the NAS by previewing these files instead. A self-hosted office server can be added
> later as an optional container if editing becomes a requirement.

## Architecture notes

**Identity.** `users` is the single identity; `accounts` holds one row per sign-in method
(`local` with an argon2id hash, `entra` keyed by object id, `ldap` keyed by objectGUID). Directory
identities link to an existing user by e-mail; local self-sign-up never attaches to a directory user.

**Sessions.** A 15-minute JWT access token and an opaque, rotating refresh token, both in `httpOnly`
cookies. Reusing a rotated refresh token revokes its whole family. The browser only ever talks to the
web origin — `/api/*` is proxied to the API — so cookies stay first-party.

**Permissions.** `permissions` rows grant `view < comment < edit < manage` on a space or document to a
user, a group or everyone. Effective access is the strongest grant on the document, any ancestor
folder, or the space. Synced Entra/LDAP groups are ordinary groups, so access follows the directory.

**Collaboration.** Each page is a Yjs document served by Hocuspocus (document name = page id). Clients
authenticate with a 10-minute token from `GET /auth/collab-token`; viewers connect read-only. The server
stores the Yjs state plus a ProseMirror JSON snapshot and plain text (used by full-text search).
Redis lets several API replicas share live documents.

**Editor extensions** (`apps/web/src/components/editor/extensions`):
- `auto-code` — classifies pasted plain text (structural heuristics + highlight.js relevance) and wraps code in a
  highlighted code block; honours VS Code's clipboard language; auto-labels unlabelled code blocks as you type.
- `web-clipper` — sanitises pasted HTML (DOMPurify), rebuilds highlighted code samples as clean `<pre><code>`,
  resolves relative URLs, and copies external images into Trigon storage via `POST /files/attachments/import`.
- `embed` — YouTube / Vimeo / Loom players and Open-Graph link cards (`GET /embeds/unfurl`, SSRF-guarded).

**Search & embeddings.** Full-text search uses a Postgres GIN index over title + body. The `embeddings`
table (pgvector, HNSW index, 1536 dims) is in place for semantic search; populating it is a next step.

## Roadmap (next)

- Share dialog UI (the API — `/permissions` — is ready)
- Trash & restore for deleted items (deletes are soft already)
- Comments, page history / snapshots
- Embedding pipeline + semantic search
- S3-compatible storage driver
