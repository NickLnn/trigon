/**
 * One-off: copy every file from local storage (STORAGE_DIR) into the S3 bucket configured with S3_*,
 * before switching to STORAGE_DRIVER=s3. Safe to run more than once: files already in the bucket with
 * the same size are skipped. Nothing is deleted locally.
 *
 *   docker compose run --rm -e STORAGE_DRIVER=s3 api node dist/files/copy-storage-to-s3.js [--dry-run]
 */
import { resolve } from 'node:path';
import { LocalStore, S3Store, s3ConfigFromEnv } from './storage-drivers';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cfg = s3ConfigFromEnv((k) => (k === 'STORAGE_DRIVER' ? 's3' : process.env[k]));
  if (!cfg) throw new Error('S3 settings missing');
  const local = new LocalStore(resolve(process.env.STORAGE_DIR ?? './storage'));
  const s3 = new S3Store(cfg);
  await s3.init();
  console.log(`Copying ${local.location()} → ${s3.location()}${dryRun ? ' (dry run)' : ''}`);

  let copied = 0;
  let skipped = 0;
  let bytes = 0;
  const failed: string[] = [];
  for await (const blob of local.list()) {
    try {
      if ((await s3.head(blob.key)) === blob.size) {
        skipped++;
        continue;
      }
      if (!dryRun) {
        await s3.put(blob.key, await local.read(blob.key));
        const size = await s3.head(blob.key);
        if (size !== blob.size) throw new Error(`size after upload is ${size}, expected ${blob.size}`);
      }
      copied++;
      bytes += blob.size;
      if (copied % 100 === 0) console.log(`  ${copied} copied…`);
    } catch (err) {
      failed.push(`${blob.key}: ${(err as Error).message}`);
    }
  }
  console.log(`${dryRun ? 'Would copy' : 'Copied'} ${copied} file(s), ${(bytes / 1024 ** 2).toFixed(1)} MB; ${skipped} already there.`);
  if (failed.length) {
    console.error(`${failed.length} failed:\n  ${failed.join('\n  ')}`);
    process.exit(1);
  }
  if (!dryRun) console.log('Done. Now set STORAGE_DRIVER=s3 (and keep the S3_* settings) and restart Trigon.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
