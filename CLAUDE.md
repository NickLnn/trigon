# Trigon — notes for Claude

- npm workspaces monorepo: `apps/api` (NestJS 11, CommonJS), `apps/web` (Next.js 16), `packages/shared`.
  Build `@trigon/shared` before typechecking/testing the apps (root scripts do this).
- Branches: `main` = stable/working only; `dev` = active development. Commit to `dev`; merge to `main` only after verification.
- The canonical checkout lives on an SMB share (`X:\trigon` → `\\192.168.31.173\docker\trigon`). `npm install`
  fails there (no junctions on network drives) — install/build/test in a local-disk copy instead.
- DB schema: `apps/api/src/db/schema.ts` (Drizzle). After changing it run `npm run db:generate -w @trigon/api`;
  the first migration also creates the `vector` extension.
- NestJS 12 is ESM-only — stay on 11 unless deliberately migrating. pdfjs-dist is v6 (`loadingTask.destroy()`, not `doc.destroy()`).
- Web production build must use webpack (`next build --webpack`) for the Serwist service worker; dev uses Turbopack without the SW.
- Tests: `node --test` + `tsx` (`*.spec.ts` in api, `*.test.ts` in web).
