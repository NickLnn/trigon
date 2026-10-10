# Running Trigon on Synology (Container Manager)

The NAS runs **prebuilt images** from GitHub Container Registry — nothing is compiled on the NAS.
Every push to GitHub builds new images automatically (see `.github/workflows/docker.yml`):

| Branch | Image tag | Use for |
| ------ | --------- | ------- |
| `main` | `:latest` | The stable install everyone uses |
| `dev`  | `:dev`    | Trying the newest work before it's merged |

Everything lives in the repository folder, e.g. `/volume1/docker/trigon`: the root `docker-compose.yml`,
your `.env`, and the `data/` folder (database, Redis, uploaded files).

## First-time setup

```bash
cd /volume1/docker/trigon
cp .env.example .env            # set POSTGRES_PASSWORD, JWT_ACCESS_SECRET, APP_URL, WEB_PORT, TRIGON_TAG
mkdir -p data/postgres data/redis data/storage && chown 1000:1000 data/storage
```

Then either:

- **Container Manager → Project → Create** — name `trigon`, path `/volume1/docker/trigon`,
  source *Use existing docker-compose.yml* → Done; or
- over SSH: `docker compose up -d`

Open `APP_URL` and register — the first account becomes admin. Database migrations run automatically every
time the API container starts.

## Updating

```bash
cd /volume1/docker/trigon && docker compose pull && docker compose up -d
```

Or in Container Manager: **Image** shows *Update available* next to `trigon-api` / `trigon-web` → **Update**,
then **Project → trigon → Action → Restart**.

Switch channels by changing `TRIGON_TAG` in `.env` (`latest` ↔ `dev`) and updating as above.

## Behind Cloudflare (later)

Point the tunnel's public hostname at `http://<nas-ip>:<WEB_PORT>`, and add a second rule for the path
`/collab` to `http://<nas-ip>:4001` (live editing). Then set `APP_URL=https://…` and `COOKIE_SECURE=true`.
