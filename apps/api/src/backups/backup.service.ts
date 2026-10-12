import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { BackupDestination, BackupDestinationStatus, BackupFile, BackupOverview, BackupRunResult, BackupSettings, GdriveConnectStatus } from '@trigon/shared';
import { CronJob } from 'cron';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ActivityService } from '../activity/activity.service';
import { SettingsService } from '../settings/settings.service';
import { BACKUP_NAME, destinationFor, nfsCompose, normalizeSmb, run, selectedDestinations, type Destination } from './destinations';
import { accessToken, deviceCode, ensureFolder, pollDeviceToken, revoke, type DeviceCode } from './gdrive';

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
export function parseBackupName(name: string): Pick<BackupFile, 'name' | 'createdAt' | 'trigger'> | null {
  if (!BACKUP_NAME.test(name)) return null;
  const m = /^trigon-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-(.+)\.tar\.gz$/.exec(name)!;
  return { name, createdAt: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString(), trigger: m[7] as BackupFile['trigger'] };
}

/** Drop `destination` (the single choice before several destinations existed) so it never round-trips. */
function withoutLegacy(s: BackupSettings): BackupSettings {
  const { destination: _legacy, ...rest } = s as BackupSettings & { destination?: unknown };
  return rest;
}

const DEST_ORDER: BackupDestination[] = ['local', 'nfs', 'smb', 'gdrive'];

const GDRIVE_STEPS = ['Sign in with Google', 'Create the backup folder in your Drive', 'Save the connection in Trigon'];

/**
 * Backups of everything Trigon stores: one .tar.gz with a PostgreSQL dump (pg_dump custom format) and the
 * uploaded files, copied to every selected destination (this server, SMB, NFS, Google Drive). Runs on a
 * schedule, keeps the newest N per destination, and restores (after taking a safety backup first).
 */
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private running: BackupOverview['running'] = null;
  private gdrive: GdriveConnectStatus = { state: 'idle', steps: GDRIVE_STEPS.map((label) => ({ label, done: false })) };

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

  private async targets(s?: BackupSettings): Promise<{ key: BackupDestination; dest: Destination }[]> {
    const settings = s ?? (await this.settings.get('backup'));
    return selectedDestinations(settings)
      .sort((a, b) => DEST_ORDER.indexOf(a) - DEST_ORDER.indexOf(b))
      .map((key) => ({ key, dest: destinationFor(settings, key) }));
  }

  private async status(key: BackupDestination, dest: Destination): Promise<BackupDestinationStatus> {
    try {
      const info = await dest.check();
      return {
        key,
        label: dest.label,
        ok: info.persistent !== false,
        message: info.persistent === false ? `${dest.label}: this folder is inside the container and would be lost when Trigon is updated.` : `Connected: ${dest.label}`,
        ...info,
      };
    } catch (err) {
      return { key, label: dest.label, ok: false, message: (err as Error).message, freeBytes: null, persistent: null };
    }
  }

  async overview(): Promise<BackupOverview> {
    const s = await this.settings.getPublic('backup');
    const targets = await this.targets();
    const destinations = await Promise.all(targets.map((t) => this.status(t.key, t.dest)));
    const byName = new Map<string, BackupFile>();
    for (const t of targets) {
      if (!destinations.find((d) => d.key === t.key)?.ok) continue;
      const files = await t.dest.list().catch(() => []);
      for (const f of files) {
        const known = byName.get(f.name);
        if (known) known.locations.push(t.key);
        else byName.set(f.name, { ...parseBackupName(f.name)!, sizeBytes: f.sizeBytes, locations: [t.key] });
      }
    }
    const files = [...byName.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      settings: withoutLegacy({ ...s, destinations: selectedDestinations(s) }),
      running: this.running,
      nextRun: this.nextRun(),
      files,
      destinations,
      nfsCompose: nfsCompose(s.nfsServer, s.nfsExport),
    };
  }

  /** Save, filling in the Google Drive folder (found or created) when its name changed. */
  async save(form: BackupSettings, userId: string) {
    const current = await this.settings.get('backup');
    const next: Partial<BackupSettings> & { destination?: undefined } = { ...(form.destinations.includes('smb') ? normalizeSmb(form) : form), destination: undefined };
    const folderName = (form.gdriveFolderName || 'Trigon Backups').trim();
    next.gdriveFolderName = folderName;
    const clientChanged = !!form.gdriveClientId && form.gdriveClientId !== current.gdriveClientId;
    if (clientChanged) Object.assign(next, { gdriveRefreshToken: null as unknown as string, gdriveAccount: null, gdriveFolderId: null });
    if (!clientChanged && current.gdriveRefreshToken && (folderName !== current.gdriveFolderName || !current.gdriveFolderId)) {
      const token = await accessToken(current.gdriveClientId, current.gdriveClientSecret ?? '', current.gdriveRefreshToken);
      next.gdriveFolderId = await ensureFolder(token, folderName);
    }
    await this.settings.update('backup', next, userId);
  }

  /** Check the destinations on the form before saving (empty secrets use the stored ones). */
  async test(form: BackupSettings) {
    const stored = await this.settings.get('backup');
    const merged: BackupSettings = {
      ...stored,
      ...form,
      smbPassword: form.smbPassword || stored.smbPassword,
      gdriveClientSecret: form.gdriveClientSecret || stored.gdriveClientSecret,
    };
    const results = await Promise.all((await this.targets(merged)).map((t) => this.status(t.key, t.dest)));
    const bad = results.filter((r) => !r.ok);
    if (!results.length) return { ok: false, message: 'Choose at least one destination.' };
    return {
      ok: !bad.length,
      message: results
        .map((r) =>
          r.ok
            ? `Trigon can write to ${r.label}.${r.freeBytes != null ? ` ${(r.freeBytes / 1024 ** 3).toFixed(1)} GB free.` : ''}`
            : r.message.startsWith(r.label) || /^(SMB|Google Drive):/.test(r.message)
              ? r.message
              : `${r.label}: ${r.message}`,
        )
        .join('  ·  '),
    };
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
    const targets = await this.targets(s);
    const name = `trigon-backup-${stampOf(started)}-${trigger}.tar.gz`;
    const work = await mkdtemp(join(tmpdir(), 'trigon-backup-'));
    let result: BackupRunResult;
    try {
      if (!targets.length) throw new Error('No backup destination is selected.');
      this.step('Exporting the database');
      await run(bin.pgDump(), ['--format=custom', '--no-owner', '--no-privileges', '--file', join(work, 'database.dump'), '--dbname', database()]);
      await writeFile(join(work, 'manifest.json'), JSON.stringify({ format: FORMAT, app: 'trigon', createdAt: started.toISOString(), trigger }, null, 2));
      await mkdir(this.storageDir(), { recursive: true });
      await symlink(this.storageDir(), join(work, 'storage'), process.platform === 'win32' ? 'junction' : 'dir');
      this.step('Packing database and files');
      const archive = join(work, name);
      await run(bin.tar(), ['-czhf', archive, '-C', work, 'manifest.json', 'database.dump', 'storage']);
      const sizeBytes = (await stat(archive)).size;

      const saved: string[] = [];
      const failed: string[] = [];
      for (const t of targets) {
        try {
          this.step(`Copying to ${t.dest.label}`);
          await t.dest.put(archive, name);
          const removed = await this.prune(t.dest, s.keep);
          saved.push(`${t.dest.label}${removed ? ` (removed ${removed} older)` : ''}`);
        } catch (err) {
          failed.push(`${t.dest.label}: ${(err as Error).message}`);
        }
      }
      if (!saved.length) throw new Error(failed.join('  ·  '));
      result = {
        ok: !failed.length,
        at: started.toISOString(),
        durationMs: Date.now() - started.getTime(),
        file: name,
        sizeBytes,
        message: `Saved to ${saved.join(', ')}.${failed.length ? ` Failed: ${failed.join('  ·  ')}` : ''}`,
        trigger,
      };
      this.activity.record({
        action: failed.length ? 'backup.failed' : 'backup.created',
        actorId,
        target: { type: 'backup', id: null, name },
        details: { destination: saved.join(', '), sizeBytes, trigger, ...(failed.length ? { reason: failed.join(' · ') } : {}) },
      });
      this.logger.log(`Backup ${name} (${(sizeBytes / 1024 ** 2).toFixed(1)} MB) → ${saved.join(', ')}${failed.length ? `; failed: ${failed.join(' · ')}` : ''}`);
    } catch (err) {
      const message = (err as Error).message;
      result = { ok: false, at: started.toISOString(), durationMs: Date.now() - started.getTime(), file: null, sizeBytes: null, message, trigger };
      this.activity.record({ action: 'backup.failed', actorId, target: { type: 'backup', id: null, name }, details: { reason: message, trigger } });
      this.logger.error(`Backup failed: ${message}`);
    } finally {
      await rm(work, { recursive: true, force: true });
      if (trigger !== 'before-restore') this.running = null;
    }
    await this.settings.update('backup', { lastRun: result! }).catch(() => undefined);
    if (!result!.file && trigger !== 'scheduled') throw new Error(result!.message);
    return result!;
  }

  /** Keep the newest `keep` backups at a destination. */
  private async prune(dest: Destination, keep: number) {
    const files = (await dest.list()).map((f) => parseBackupName(f.name)!).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const old = files.slice(Math.max(1, keep));
    for (const f of old) await dest.remove(f.name);
    return old.length;
  }

  /** Fetch a backup from the first destination that has it. */
  private async fetch(name: string, localFile: string, from?: BackupDestination) {
    const targets = (await this.targets()).filter((t) => !from || t.key === from);
    const errors: string[] = [];
    for (const t of targets) {
      try {
        if (!(await t.dest.list()).some((f) => f.name === name)) continue;
        await t.dest.get(name, localFile);
        return t.dest.label;
      } catch (err) {
        errors.push(`${t.dest.label}: ${(err as Error).message}`);
      }
    }
    throw new Error(errors.length ? errors.join(' · ') : `${name} was not found at any backup destination.`);
  }

  async download(name: string, from?: BackupDestination): Promise<{ file: string; cleanup: () => Promise<void> }> {
    if (!BACKUP_NAME.test(name)) throw new BadRequestException('Not a Trigon backup');
    const work = await mkdtemp(join(tmpdir(), 'trigon-download-'));
    const file = join(work, name);
    try {
      await this.fetch(name, file, from);
    } catch (err) {
      await rm(work, { recursive: true, force: true });
      throw new BadRequestException((err as Error).message);
    }
    return { file, cleanup: () => rm(work, { recursive: true, force: true }) };
  }

  /** Delete a backup everywhere it is stored. */
  async remove(name: string, actorId: string) {
    if (!BACKUP_NAME.test(name)) throw new BadRequestException('Not a Trigon backup');
    const removedFrom: string[] = [];
    for (const t of await this.targets()) {
      if (!(await t.dest.list().catch(() => [])).some((f) => f.name === name)) continue;
      await t.dest.remove(name);
      removedFrom.push(t.dest.label);
    }
    this.activity.record({ action: 'backup.deleted', actorId, target: { type: 'backup', id: null, name }, details: { destination: removedFrom.join(', ') } });
  }

  /**
   * Restore: safety backup first, then the database (one transaction — all or nothing) and the files.
   * The backup settings in use now are kept. Trigon then restarts so every cache starts fresh.
   */
  async restore(name: string, actorId: string, onDone: () => void) {
    if (!BACKUP_NAME.test(name)) throw new BadRequestException('Not a Trigon backup');
    if (this.running) throw new ConflictException(`A ${this.running.kind} is already running.`);
    this.running = { kind: 'restore', step: 'Taking a safety backup of the current state', startedAt: new Date().toISOString() };
    const current = await this.settings.get('backup');
    const work = await mkdtemp(join(tmpdir(), 'trigon-restore-'));
    try {
      await this.backup('before-restore', actorId);
      this.step('Fetching the backup');
      const source = await this.fetch(name, join(work, name));
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
      this.activity.record({ action: 'backup.restored', actorId, target: { type: 'backup', id: null, name }, details: { destination: source } });
      this.logger.warn(`Restored backup ${name} from ${source}; restarting.`);
      onDone();
    } catch (err) {
      this.logger.error(`Restore of ${name} failed: ${(err as Error).message}`);
      throw err;
    } finally {
      this.running = null;
      await rm(work, { recursive: true, force: true });
    }
  }

  // ─── Google Drive connection (device sign-in: a code entered at google.com/device) ───

  gdriveStatus(): GdriveConnectStatus {
    return this.gdrive;
  }

  private gdriveStep(index: number) {
    this.gdrive = { ...this.gdrive, steps: this.gdrive.steps.map((st, i) => ({ ...st, done: i <= index })) };
  }

  /** Save the OAuth client (when given), ask Google for a code, and finish in the background once it is approved. */
  async gdriveStart(userId: string, clientId?: string, clientSecret?: string): Promise<GdriveConnectStatus> {
    if (this.gdrive.state === 'waiting_for_sign_in' || this.gdrive.state === 'working') return this.gdrive;
    if (clientId || clientSecret) {
      const patch: Partial<BackupSettings> = {};
      if (clientId) patch.gdriveClientId = clientId.trim();
      if (clientSecret) patch.gdriveClientSecret = clientSecret.trim();
      await this.settings.update('backup', patch, userId);
    }
    const s = await this.settings.get('backup');
    if (!s.gdriveClientId || !s.gdriveClientSecret) throw new BadRequestException('Enter the client ID and client secret from Google Cloud Console.');
    this.gdrive = { state: 'waiting_for_sign_in', steps: GDRIVE_STEPS.map((label) => ({ label, done: false })) };
    let code: DeviceCode;
    try {
      code = await deviceCode(s.gdriveClientId);
    } catch (err) {
      this.gdrive = { ...this.gdrive, state: 'error', message: (err as Error).message };
      return this.gdrive;
    }
    this.gdrive = {
      ...this.gdrive,
      userCode: code.userCode,
      verificationUrl: code.verificationUrl,
      expiresAt: new Date(Date.now() + code.expiresIn * 1000).toISOString(),
    };
    void (async () => {
      try {
        const { refreshToken, accessToken: token, email } = await pollDeviceToken(s.gdriveClientId, s.gdriveClientSecret ?? '', code);
        this.gdrive = { ...this.gdrive, state: 'working', userCode: undefined };
        this.gdriveStep(0);
        const folderName = s.gdriveFolderName || 'Trigon Backups';
        const folderId = await ensureFolder(token, folderName);
        this.gdriveStep(1);
        const current = await this.settings.get('backup');
        const destinations = [...new Set([...selectedDestinations(current), 'gdrive' as const])];
        await this.settings.update('backup', { gdriveRefreshToken: refreshToken, gdriveAccount: email, gdriveFolderId: folderId, gdriveFolderName: folderName, destinations }, userId);
        this.gdriveStep(2);
        this.activity.record({ action: 'settings.updated', actorId: userId, target: { type: 'settings', id: null, name: 'Backups' }, details: { fields: ['Google Drive connected'] } });
        this.gdrive = { ...this.gdrive, state: 'done', message: `Connected${email ? ` as ${email}` : ''}. Backups go to My Drive › ${folderName}.` };
      } catch (err) {
        this.gdrive = { ...this.gdrive, state: 'error', userCode: undefined, message: (err as Error).message };
      }
    })();
    return this.gdrive;
  }

  async gdriveDisconnect(userId: string) {
    const s = await this.settings.get('backup');
    if (s.gdriveRefreshToken) await revoke(s.gdriveRefreshToken);
    const remaining = selectedDestinations(s).filter((d) => d !== 'gdrive');
    await this.settings.update(
      'backup',
      { gdriveRefreshToken: null as unknown as string, gdriveAccount: null, gdriveFolderId: null, destinations: remaining.length ? remaining : ['local'] },
      userId,
    );
    this.gdrive = { state: 'idle', steps: GDRIVE_STEPS.map((label) => ({ label, done: false })) };
  }
}
