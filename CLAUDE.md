# Trigon — notes for Claude

- npm workspaces monorepo: `apps/api` (NestJS 11, CommonJS), `apps/web` (Next.js 16), `packages/shared`.
  Build `@trigon/shared` before typechecking/testing the apps (root scripts do this).
- Branches: `main` = stable/working only; `dev` = active development. Commit to `dev`; merge to `main` only after verification.
- The canonical checkout lives on an SMB share (`X:\trigon` → `\\192.168.xxx.xxx\docker\trigon`). `npm install`
  fails there (no junctions on network drives) — install/build/test in a local-disk copy instead.
- DB schema: `apps/api/src/db/schema.ts` (Drizzle). After changing it run `npm run db:generate -w @trigon/api`;
  the first migration also creates the `vector` extension.
- NestJS 12 is ESM-only — stay on 11 unless deliberately migrating. pdfjs-dist is v6 (`loadingTask.destroy()`, not `doc.destroy()`).
- Web production build must use webpack (`next build --webpack`) for the Serwist service worker; dev uses Turbopack without the SW.
- Tests: `node --test` + `tsx` (`*.spec.ts` in api, `*.test.ts` in web).

## Security invariants (ISO 27001 / NIS2) — every change must keep these

**Access control**
- Every route is authenticated by the global `JwtAuthGuard`; `@Public()` only for sign-in routes and `health`.
  Admin areas (`activity`, `backups`, `directory`, `settings/*`, `admin`) are `@Roles('admin')` at class level.
- Any route taking a document/space/comment/review/version/attachment/permission id calls
  `PermissionsService.assertDocument/assertSpace` (or `documentLevel`) **before** reading or writing it.
  Lists filter by `spaceLevels()`. Never trust the role inside a JWT: `JwtStrategy` reloads it (`UserStatusService`).
- New routes must be added to `apps/api/src/common/authz.spec.ts` (route inventory + BOLA table) or the test fails.
- Live editing (`collab.service.ts`) re-checks access on messages and on a timer; keep that path for new hooks.

**Secrets**
- Third-party secrets in the DB go through `SECRET_FIELDS` (AES-256-GCM via `SecretBox`); APIs return `getPublic()`
  (has* flags), never raw values. "Test connection" uses `storedSecretFor()` so a stored secret can't be sent elsewhere.
- Never log or audit passwords, tokens or keys; `ActivityService` redacts, but don't rely on it.
- `JWT_ACCESS_SECRET` / `SETTINGS_ENCRYPTION_KEY` must pass `validateEnv` (≥ 32 random chars).

**Untrusted input**
- Server-side fetches of user-supplied URLs go only through `safeFetch()` (`common/ssrf.ts`): public addresses only,
  pinned lookup, size cap, re-checked per redirect. Never call `fetch()` on a user URL directly.
- External programs: `execFile`/`spawn` with argument arrays, a timeout and bounded output — never a shell string.
  Validate anything that ends up as an argument (`langArg`, `smbProblem`).
- Uploaded files are served with `fileResponseHeaders()` (no inline HTML/SVG/JS, sandbox CSP). Image types come from
  the bytes (`sniffImage`), not the browser's MIME type. Storage keys must pass `isKey()`.
- Archives (backup restore) are listed and checked (`archiveProblem`) before extraction; blobs are imported via `blobsIn()`.
- Web: pasted/imported HTML goes through `cleanPastedHtml()` (DOMPurify); URLs from documents or Yjs attributes go
  through `webUrl`/`safeHref`/`safeImageSrc`/`embedTarget`. No `dangerouslySetInnerHTML` without DOMPurify.

**Audit & infrastructure**
- Security-relevant actions are recorded with `ActivityService.record()` (actor, IP and user agent come from
  `request-context`). Settings changes are audited centrally by `SettingsService.update(…, userId)` — pass the userId.
- Only the web port is published in `docker-compose.yml`; containers run as `node` with `cap_drop: [ALL]` and
  `no-new-privileges`. Images and GitHub Actions are pinned by digest/SHA; update them via Dependabot PRs.
- CI fails on high/critical `npm audit` findings in runtime dependencies.
