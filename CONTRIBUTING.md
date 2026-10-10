# Contributing to Trigon

## How we work

```
feature/your-thing ──PR──▶ dev ──PR (after testing)──▶ main
```

- **`main`** is what runs for everyone. Only merged from `dev` once things are tested. Pushing to it
  publishes the `:latest` images that the NAS runs.
- **`dev`** is the shared integration branch. Every push builds `:dev` images you can try on the NAS.
- **Your work** happens on a short-lived branch off `dev`, e.g. `feature/share-links` or `fix/pdf-search`,
  merged back with a pull request.

```bash
git checkout dev && git pull
git checkout -b feature/my-change
# …work, commit…
git push -u origin feature/my-change
```

Then open a pull request **into `dev`** on GitHub. CI (typecheck, tests, builds) must pass; the other person
reviews and merges. Keep PRs focused — one feature or fix each.

## Setting up your machine

You need **Node.js 22+**, **Git**, and **Docker Desktop** (only for Postgres and Redis).

```bash
git clone https://github.com/NickLnn/trigon.git
cd trigon
git checkout dev
npm install
cp .env.example .env            # then set JWT_ACCESS_SECRET to any long random string
docker compose up -d postgres redis
npm run db:migrate
npm run dev                     # API on :4000 (+ live editing on :4001), web on http://localhost:3000
```

Open http://localhost:3000 and register — on a fresh database the first account is the admin.

> Clone onto a **local disk**. npm workspaces don't install on network shares.

## Project map

| Path | What |
| ---- | ---- |
| `apps/api` | NestJS backend — auth, permissions, documents, files, settings, Yjs collaboration server |
| `apps/api/src/db/schema.ts` | Database schema (Drizzle). After changing it: `npm run db:generate` and commit the new migration |
| `apps/web` | Next.js frontend (App Router, Tailwind 4, Tiptap editor, PWA) |
| `apps/web/src/components/editor` | Editor and its extensions (slash menu, callouts, code blocks, web clipper…) |
| `packages/shared` | Types and helpers used by both apps |
| `deploy/synology` | How the NAS runs the published images |

## Before you push

```bash
npm run typecheck
npm test
```

Both also run in CI on every push and pull request.

## Conventions

- Match the style of the surrounding code; TypeScript strict mode everywhere.
- UI text in sentence case ("Create space", not "Create Space").
- Colours come from the design tokens in `apps/web/src/app/globals.css` (`bg-surface`, `text-ink-2`,
  `bg-navy`, `text-accent`…) — no hard-coded hex in components, so dark mode keeps working.
- Database changes always come with a generated migration in `apps/api/drizzle/`.
- Never commit `.env` files, passwords or tokens.
