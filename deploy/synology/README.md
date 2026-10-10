# Running Trigon on Synology (Container Manager)

The NAS runs **prebuilt images** from GitHub Container Registry — nothing is compiled on the NAS.
Every push to GitHub builds new images automatically (see `.github/workflows/docker.yml`):

| Branch | Image tag | Use for |
| ------ | --------- | ------- |
| `main` | `:latest` | The stable install everyone uses |
| `dev`  | `:dev`    | Trying the newest work before it's merged |

## First-time setup

1. **Create a folder** for the app (separate from any source code), e.g. `/volume1/docker/trigon-app`,
   and inside it the data folders:

   ```bash
   mkdir -p /volume1/docker/trigon-app/data/{postgres,redis,storage}
   chown 1000:1000 /volume1/docker/trigon-app/data/storage
   ```

2. **Copy** `docker-compose.yml` and `.env.example` from this folder into it, rename `.env.example` to `.env`
   and fill in `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` and `APP_URL`.

3. **Container Manager → Project → Create**
   - Project name: `trigon`
   - Path: `/volume1/docker/trigon-app`
   - Source: *Use existing docker-compose.yml*
   - Skip the Web Station portal step → **Done**. Container Manager pulls the images and starts everything.

4. Open `APP_URL` and register — the first account becomes admin.

Database migrations run automatically every time the API container starts.

## Updating

Over SSH (most reliable):

```bash
cd /volume1/docker/trigon-app && docker compose pull && docker compose up -d
```

Or in Container Manager: **Image** shows *Update available* next to `trigon-api` / `trigon-web` → **Update**,
then **Project → trigon → Action → Restart**.

Switch channels by changing `TRIGON_TAG` in `.env` (`latest` ↔ `dev`) and updating as above.

## Moving from the old source-built install

If you previously ran `docker compose up --build` from the repository folder, keep your data:

```bash
cd /volume1/docker/trigon && docker compose down          # stop the old stack (data stays on disk)
mkdir -p /volume1/docker/trigon-app
cp -a /volume1/docker/trigon/data /volume1/docker/trigon-app/  # postgres, redis, uploaded files
cp /volume1/docker/trigon/.env /volume1/docker/trigon-app/.env
```

Then add `TRIGON_TAG=dev` (or `latest`) to the copied `.env`, copy `docker-compose.yml` from this folder in,
and create the Container Manager project (step 3 above). Once it's confirmed working, the old `data/` folder
in the repository can be deleted.

## Behind Cloudflare (later)

Point the tunnel's public hostname at `http://<nas-ip>:8797`, and add a second rule for the path `/collab`
to `http://<nas-ip>:4001` (live editing). Then set `APP_URL=https://…` and `COOKIE_SECURE=true` in `.env`.
