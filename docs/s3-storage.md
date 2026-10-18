# Keeping files in S3-compatible storage

By default Trigon keeps uploaded files, images pasted into pages, and icons on the server, in
`data/storage`. You can keep them in any **S3-compatible bucket** instead: AWS S3, Backblaze B2,
Wasabi, Cloudflare R2, Synology C2, or a self-hosted MinIO / SeaweedFS / Garage.

Pages, comments, settings and history stay in the database either way. Only the files move.

> **Most installs don't need this.** Local storage is simpler and its backups include the files.
> S3 makes sense when the NAS disk is small, or when you already run object storage with its own
> versioning and replication.

## 1. Create a bucket and a key

1. Create a **private** bucket, for example `trigon-files`.
2. Turn on **versioning**, so deleted or overwritten files can be recovered. If your provider offers
   replication or object lock, those help too.
3. Create an access key that can **read, write, list and delete** in that bucket only.

## 2. Copy the files you already have

Skip this step for a brand-new install. Otherwise, add the S3 settings to `.env` (next to
`docker-compose.yml`) first, **leaving `STORAGE_DRIVER` out for now**:

```bash
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com   # or https://<account>.r2.cloudflarestorage.com, http://minio:9000 …
S3_REGION=eu-central-1                              # "auto" for R2; any value for MinIO
S3_BUCKET=trigon-files
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
#S3_PREFIX=trigon            # optional folder inside the bucket
#S3_PATH_STYLE=false         # only for providers that need bucket.endpoint addresses
```

Then copy everything across:

```bash
cd /volume1/docker/trigon
docker compose run --rm api node dist/files/copy-storage-to-s3.js --dry-run   # shows what would be copied
docker compose run --rm api node dist/files/copy-storage-to-s3.js
```

The copy command:

- checks every upload,
- skips files that are already in the bucket, so you can safely run it again,
- never deletes anything locally.

## 3. Switch

Add this line to `.env`:

```bash
STORAGE_DRIVER=s3
```

Then restart Trigon with `docker compose up -d`. The API log should show
`Files are stored in S3: trigon-files at …`, and **Settings → Storage** names the bucket.

Open a few pages with images and some uploaded files to check they load. Keep `data/storage` until
you are sure; after that it can be deleted.

## Backups

With files in S3, Trigon's backups contain **the database only** (Settings → Backups says so). That
covers pages, comments, settings and history. Protect the files in the bucket itself, with
versioning and, if your provider offers it, replication.

A backup made while files were local still contains them. Restoring it while `STORAGE_DRIVER=s3`
uploads those files into the bucket.

## Going back to local storage

There's no reverse copy command. Download the bucket's contents into `data/storage`, keeping the
same layout (`xx/<file id>`), for example with `rclone copy` or `aws s3 sync`. Then remove
`STORAGE_DRIVER` and restart.

## Notes

- **No extra memory, nothing new to run.** Trigon talks to S3 over plain HTTPS with signed requests.
- **OCR and PDF text still work.** Each file is copied to a temporary file while it is being read,
  then deleted.
- **Settings → Storage** can't show free disk space for a bucket. The leftover-file check works
  the same as with local storage.
