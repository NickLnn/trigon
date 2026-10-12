import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { BackupFile, BackupOverview, BackupRunResult, BackupSettings } from '@trigon/shared';
import { CronJob } from 'cron';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ActivityService } from '../activity/activity.service';
import { SettingsService } from '../settings/settings.service';
import { BACKUP_NAME, destinationFor, nfsCompose, run, type Destination } from './destinations';

const JOB = 'trigon-backup';
const FORMAT = 1;

const bin = {
  pgDump: () => process.env.PG_DUMP_BIN || 'pg_dump',
  pgRestore: () => process.env.PG_RESTORE_BIN || 'pg_restore',
  tar: () => process.env.TAR_BIN || 'tar',
};

/** Connection for pg_dump / pg_restore: DATABASE_URL when set, else the PG* variables (Docker). */
const database = () => process.env.DATABASE_URL || process.env.PGDATABASE || 'trigon';

const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15).replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

/** trigon-backup-2026-10-12_020000-scheduled.tar.gz → date and trigger. */
export function parseBackupName(name: string): Omit<BackupFile, 'sizeBytes'> | null {
  if (!BACKUP_NAME.test(name)) return null;
  const m = /^trigon-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-(.+)\.tar\.gz$/.exec(name)!;
  return { name, createdAt: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString(), trigger: m[7] as BackupFile['trigger'] };
}

/**
 * Backups of everything Trigon stores: one .tar.gz with a PostgreSQL dump (pg_dump custom format) and the
 * uploaded files, written to a folder on this server, an SMB share or an NFS export. Runs on a schedule,
 * keeps the newest N, and restores (after taking a safety backup first).
 */
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private running: BackupOverview['running'] = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly scheduler: SchedulerRegistry,
    private readonly activity: ActivityService,
  ) {
    settings.changes.on('changed', (key) => key === 'backup' && void this.schedule());
  }

  async onModuleInit() {
    await this.schedule();
  }

  private async schedule() {
    if (this.scheduler.doesExist('cron', JOB)) this.scheduler.deleteCronJob(JOB);
    const s = await this.settings.get('backup');
    if (!s.enabled || !s.schedule) return;
    try {
      const job = CronJob.from({ cronTime: s.schedule, onTick: () => void this.backup('scheduled').catch(() => undefined) });
      this.scheduler.addCronJob(JOB, job);
      job.start();
      this.logger.log(`Backups scheduled: ${s.schedule}`);
    } catch (err) {
      this.logger.error(`Invalid backup schedule "${s.schedule}": ${(err as Error).message}`);
    }
  }

  private nextRun(): string | null {
    if (!this.scheduler.doesExist('cron', JOB)) return null;
    const next = this.scheduler.getCronJob(JOB).nextDate();
    return next ? next.toJSDate().toISOString() : null;
  }

  private step(step: string) {
    if (this.running) this.running = { ...this.running, step };
  }

  private storageDir() {
    return resolve(process.env.STORAGE_DIR ?? './storage');
  }

  async overview(): Promise<BackupOverview> {
    const s = await this.settings.getPublic('backup');
    const dest = destinationFor(await this.settings.get('backup'));
    let files: BackupFile[] = [];
    let destination: BackupOverview['destination'];
    try {
      const info = await dest.check();
      files = (await dest.list())
        .map((f) => ({ ...parseBackupName(f.name)!, sizeBytes: f.sizeBytes }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      destination = {
        ok: true,
        message: info.persistent === false ? 'This folder is inside the container and would be lost when Trigon is updated.' : `Connected: ${dest.label}`,
        ...info,
      };
    } catch (err) {
      destination = { ok: false, message: (err as Error).message, freeBytes: null, persistent: null };
    }
    return { settings: s, running: this.running, nextRun: this.nextRun(), files, destination, nfsCompose: nfsCompose(s.nfsServer, s.nfsExport) };
  }

  /** Check a destination before saving (form values; an empty password uses the stored one). */
  async test(form: BackupSettings) {
    const stored = await this.settings.get('backup');
    const dest = destinationFor({ ...form, smbPassword: form.smbPassword || stored.smbPassword });
    try {
      const info = await dest.check();
      if (info.persistent === false) {
        return { ok: false, message: `Trigon can write to ${dest.label}, but that folder is inside the container and is lost when Trigon is updated. Map it to a folder on the NAS in docker-compose.yml.` };
      }
      return { ok: true, message: `Trigon can write to ${dest.label}.${info.freeBytes != null ? ` ${(info.freeBytes / 1024 ** 3).toFixed(1)} GB free.` : ''}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /** Start a backup in the background (the UI polls the overview). */
  start(trigger: BackupRunResult['trigger'], actorId: string | null) {
    if (this.running) throw new ConflictException(`A ${this.running.kind} is already running.`);
    void this.backup(trigger, actorId).catch(() => undefined);
    return { started: true };
  }

  async backup(trigger: BackupRunResult['trigger'], actorId: string | null = null): Promise<BackupRunResult> {
    if (this.running && trigger !== 'before-restore') throw new ConflictException(`A ${this.running.kind} is already running.`);
    const started = new Date();
    if (!this.running) this.running = { kind: 'backup', step: 'Starting', startedAt: started.toISOString() };
    const s = await this.settings.get('backup');
    const dest = destinationFor(s);
    const name = `trigon-backup-${stampOf(started)}-${trigger}.tar.gz`;
    const work = await mkdtemp(join(tmpdir(), 'trigon-backup-'));
    let result: BackupRunResult;
    try {
      this.step('Exporting the database');
      await run(bin.pgDump(), ['--format=custom', '--no-owner', '--no-privileges', '--file', join(work, 'database.dump'), '--dbname', database()]);
      await writeFile(join(work, 'manifest.json'), JSON.stringify({ format: FORMAT, app: 'trigon', createdAt: started.toISOString(), trigger }, null, 2));
      await mkdir(this.storageDir(), { recursive: true });
      await symlink(this.storageDir(), join(work, 'storage'), process.platform === 'win32' ? 'junction' : 'dir');
      this.step('Packing database and files');
      const archive = join(work, name);
      await run(bin.tar(), ['-czhf', archive, '-C', work, 'manifest.json', 'database.dump', 'storage']);
      const sizeBytes = (await stat(archive)).size;
      this.step(`Copying to ${dest.label}`);
      await dest.put(archive, name);
      this.step('Removing old backups');
      const removed = await this.prune(dest, s.keep);
      result = {
        ok: true,
        at: started.toISOString(),
        durationMs: Date.now() - started.getTime(),
        file: name,
        sizeBytes,
        message: `Saved to ${dest.label}${removed ? `; removed ${removed} older backup${removed === 1 ? '' : 's'}` : ''}.`,
        trigger,
      };
      this.activity.record({ action: 'backup.created', actorId, target: { type: 'backup', id: null, name }, details: { destination: dest.label, sizeBytes, trigger } });
      this.logger.log(`Backup ${name} (${(sizeBytes / 1024 ** 2).toFixed(1)} MB) → ${dest.label}`);
    } catch (err) {
      const message = (err as Error).message;
      result = { ok: false, at: started.toISOString(), durationMs: Date.now() - started.getTime(), file: null, sizeBytes: null, message, trigger };
      this.activity.record({ action: 'backup.failed', actorId, target: { type: 'backup', id: null, name }, details: { destination: dest.label, reason: message, trigger } });
      this.logger.error(`Backup failed: ${message}`);
    } finally {
      await rm(work, { recursive: true, force: true });
      if (trigger !== 'before-restore') this.running = null;
    }
    await this.settings.update('backup', { lastRun: result! }).catch(() => undefined);
    if (!result!.ok && trigger !== 'scheduled') throw new Error(result!.message);
    return result!;
  }

  /** Keep the newest `keep` backups at the destination. */
  private async prune(dest: Destination, keep: number) {
    const files = (await dest.list()).map((f) => parseBackupName(f.name)!).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const old = files.slice(Math.max(1, keep));
    for (const f of old) await dest.remove(f.name);
    return old.length;
  }

  async download(name: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
    if (!BACKUP_NAME.test(name)) throw new ConflictException('Not a Trigon backup');
    const dest = destinationFor(await this.settings.get('backup'));
    const work = await mkdtemp(join(tmpdir(), 'trigon-download-'));
    const file = join(work, name);
    await dest.get(name, file);
    return { file, cleanup: () => rm(work, { recursive: true, force: true }) };
  }

  async remove(name: string, actorId: string) {
    if (!BACKUP_NAME.test(name)) throw new ConflictException('Not a Trigon backup');
    const dest = destinationFor(await this.settings.get('backup'));
    await dest.remove(name);
    this.activity.record({ action: 'backup.deleted', actorId, target: { type: 'backup', id: null, name }, details: { destination: dest.label } });
  }

  /**
   * Restore: safety backup first, then the database (one transaction — all or nothing) and the files.
   * The backup settings in use now are kept. Trigon then restarts so every cache starts fresh.
   */
  async restore(name: string, actorId: string, onDone: () => void) {
    if (!BACKUP_NAME.test(name)) throw new ConflictException('Not a Trigon backup');
    if (this.running) throw new ConflictException(`A ${this.running.kind} is already running.`);
    this.running = { kind: 'restore', step: 'Taking a safety backup of the current state', startedAt: new Date().toISOString() };
    const current = await this.settings.get('backup');
    const work = await mkdtemp(join(tmpdir(), 'trigon-restore-'));
    try {
      await this.backup('before-restore', actorId);
      this.step('Fetching the backup');
      const dest = destinationFor(current);
      await dest.get(name, join(work, name));
      this.step('Unpacking');
      await run(bin.tar(), ['-xzf', join(work, name), '-C', work]);
      const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')) as { app?: string; format?: number };
      if (manifest.app !== 'trigon') throw new Error('This file is not a Trigon backup.');
      this.step('Restoring the database');
      await run(bin.pgRestore(), ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--dbname', database(), join(work, 'database.dump')]);
      this.step('Restoring files');
      await mkdir(this.storageDir(), { recursive: true });
      await cp(join(work, 'storage'), this.storageDir(), { recursive: true, force: true }).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
      // The restored database carries the backup settings of that day; keep today's.
      const { lastRun: _old, ...keep } = current;
      await this.settings.update('backup', { ...keep, lastRun: { ok: true, at: new Date().toISOString(), durationMs: 0, file: name, sizeBytes: null, message: `Restored ${name}.`, trigger: 'manual' } });
      this.activity.record({ action: 'backup.restored', actorId, target: { type: 'backup', id: null, name }, details: { destination: dest.label } });
      this.logger.warn(`Restored backup ${name}; restarting.`);
      onDone();
    } catch (err) {
      this.logger.error(`Restore of ${name} failed: ${(err as Error).message}`);
      throw err;
    } finally {
      this.running = null;
      await rm(work, { recursive: true, force: true });
    }
  }
}
