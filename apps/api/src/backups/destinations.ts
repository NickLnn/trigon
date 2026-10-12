import { spawn } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BackupSettings } from '@trigon/shared';

/** trigon-backup-2026-10-12_0200-scheduled.tar.gz */
export const BACKUP_NAME = /^trigon-backup-\d{4}-\d{2}-\d{2}_\d{6}-(scheduled|manual|before-restore)\.tar\.gz$/;
export const NFS_MOUNT = '/data/backups-nfs';

export interface StoredFile {
  name: string;
  sizeBytes: number;
}

/** Somewhere backups can be written to, listed, read back and deleted. */
export interface Destination {
  readonly label: string;
  put(localFile: string, name: string): Promise<void>;
  list(): Promise<StoredFile[]>;
  get(name: string, localFile: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Write and delete a small file, to prove the destination works. */
  check(): Promise<{ freeBytes: number | null; persistent: boolean | null }>;
}

/**
 * Run a program, collecting output; rejects with its stderr (secrets never appear on the command line).
 * `cmd` may carry fixed leading arguments separated by " | " (e.g. "node | stub.js"), used by tests.
 */
export function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<string> {
  const [program, ...prefix] = cmd.split(' | ');
  return new Promise((ok, fail) => {
    const child = spawn(program, [...prefix, ...args], { env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 30 * 60_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      fail(new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? `${program} is not installed in this container` : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) ok(out);
      else fail(new Error((err || out).trim().split('\n').slice(-3).join(' ') || `${program} exited with code ${code}`));
    });
  });
}

/** Is `dir` on its own mount (a Docker volume / bind mount), i.e. does it survive container updates? */
export function isMounted(dir: string): boolean | null {
  try {
    const target = resolve(dir);
    const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .map((l) => l.split(' ')[4])
      .filter((m) => m && m !== '/');
    return mounts.some((m) => target === m || target.startsWith(`${m}/`));
  } catch {
    return null;
  }
}

/** A folder in the container: ./data/backups on the host, or an NFS export mounted by Docker. */
export class FolderDestination implements Destination {
  constructor(
    private readonly dir: string,
    readonly label: string,
  ) {}

  async put(localFile: string, name: string) {
    await mkdir(this.dir, { recursive: true });
    await copyFile(localFile, join(this.dir, name));
  }

  async list() {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = names.filter((n) => BACKUP_NAME.test(n));
    return Promise.all(files.map(async (name) => ({ name, sizeBytes: (await stat(join(this.dir, name))).size })));
  }

  async get(name: string, localFile: string) {
    await copyFile(join(this.dir, name), localFile);
  }

  stream(name: string) {
    return createReadStream(join(this.dir, name));
  }

  async remove(name: string) {
    await rm(join(this.dir, name), { force: true });
  }

  async check() {
    const probe = join(this.dir, `.trigon-write-test-${Date.now()}`);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(probe, 'ok');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EACCES' || (err as NodeJS.ErrnoException).code === 'EPERM') {
        throw new Error(
          `Trigon may not write to ${this.dir}. On the NAS, give the folder to Trigon's user once: in the trigon folder run  sudo chown 1000:1000 data/backups  (or the NFS export's folder).`,
        );
      }
      throw err;
    }
    await rm(probe, { force: true });
    let freeBytes: number | null = null;
    try {
      const s = await statfs(this.dir);
      freeBytes = s.bavail * s.bsize;
    } catch {
      /* not supported here */
    }
    return { freeBytes, persistent: isMounted(this.dir) };
  }
}

/**
 * An SMB/CIFS share, reached with smbclient — no mount, so the container needs no extra privileges.
 * Credentials go in a temporary 0600 auth file, never on the command line.
 */
export class SmbDestination implements Destination {
  readonly label: string;
  private readonly bin = process.env.SMBCLIENT_BIN || 'smbclient';

  constructor(private readonly s: BackupSettings) {
    this.label = `\\\\${s.smbHost}\\${s.smbShare}${s.smbPath ? `\\${s.smbPath.replace(/\//g, '\\')}` : ''}`;
  }

  private folder() {
    return this.s.smbPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  private async exec(commands: string) {
    if (!this.s.smbHost || !this.s.smbShare) throw new Error('Enter the SMB server and share.');
    const authFile = join(tmpdir(), `trigon-smb-${process.pid}-${Date.now()}`);
    const args = [`//${this.s.smbHost}/${this.s.smbShare}`, '-m', 'SMB3', '-c', commands];
    if (this.s.smbUser) {
      const lines = [`username = ${this.s.smbUser}`, `password = ${this.s.smbPassword ?? ''}`, ...(this.s.smbDomain ? [`domain = ${this.s.smbDomain}`] : [])];
      await writeFile(authFile, lines.join('\n') + '\n', { mode: 0o600 });
      args.push('-A', authFile);
    } else {
      args.push('-N');
    }
    try {
      return await run(this.bin, args, { timeoutMs: 60 * 60_000 });
    } catch (err) {
      const msg = (err as Error).message;
      if (/NT_STATUS_LOGON_FAILURE/.test(msg)) throw new Error('SMB: wrong user name or password.');
      if (/NT_STATUS_BAD_NETWORK_NAME/.test(msg)) throw new Error(`SMB: the share "${this.s.smbShare}" does not exist on ${this.s.smbHost}.`);
      if (/NT_STATUS_(HOST_UNREACHABLE|IO_TIMEOUT|CONNECTION_REFUSED)|Connection to .* failed/.test(msg)) throw new Error(`SMB: can't reach ${this.s.smbHost}.`);
      if (/NT_STATUS_ACCESS_DENIED/.test(msg)) throw new Error('SMB: access denied — the user needs write permission on the share.');
      throw new Error(`SMB: ${msg}`);
    } finally {
      await rm(authFile, { force: true });
    }
  }

  private q(s: string) {
    return `"${s.replace(/"/g, '')}"`;
  }

  /** cd into the folder, creating each level when missing. */
  private async cdCommands() {
    const parts = this.folder().split('/').filter(Boolean);
    let path = '';
    for (const p of parts) {
      path = path ? `${path}/${p}` : p;
      await this.exec(`mkdir ${this.q(path)}`).catch(() => undefined);
    }
    return parts.length ? `cd ${this.q(this.folder())}; ` : '';
  }

  async put(localFile: string, name: string) {
    await this.exec(`${await this.cdCommands()}put ${this.q(localFile)} ${this.q(name)}`);
  }

  async list() {
    const cd = this.folder() ? `cd ${this.q(this.folder())}; ` : '';
    let out: string;
    try {
      out = await this.exec(`${cd}ls`);
    } catch (err) {
      if (/NT_STATUS_OBJECT_(NAME|PATH)_NOT_FOUND/.test((err as Error).message)) return [];
      throw err;
    }
    const files: StoredFile[] = [];
    for (const line of out.split('\n')) {
      const m = /^\s+(trigon-backup-\S+\.tar\.gz)\s+[A-Z]*\s+(\d+)\s/.exec(line);
      if (m && BACKUP_NAME.test(m[1])) files.push({ name: m[1], sizeBytes: Number(m[2]) });
    }
    return files;
  }

  async get(name: string, localFile: string) {
    const cd = this.folder() ? `cd ${this.q(this.folder())}; ` : '';
    await this.exec(`${cd}get ${this.q(name)} ${this.q(localFile)}`);
  }

  async remove(name: string) {
    const cd = this.folder() ? `cd ${this.q(this.folder())}; ` : '';
    await this.exec(`${cd}del ${this.q(name)}`);
  }

  async check() {
    const probe = join(tmpdir(), `trigon-write-test-${Date.now()}`);
    const name = '.trigon-write-test';
    await writeFile(probe, 'ok');
    try {
      await this.exec(`${await this.cdCommands()}put ${this.q(probe)} ${this.q(name)}; del ${this.q(name)}`);
    } finally {
      await rm(probe, { force: true });
    }
    return { freeBytes: null, persistent: true };
  }
}

export function destinationFor(s: BackupSettings): Destination {
  if (s.destination === 'smb') return new SmbDestination(s);
  if (s.destination === 'nfs') return new FolderDestination(NFS_MOUNT, `NFS ${s.nfsServer || 'server'}:${s.nfsExport || '/export'}`);
  return new FolderDestination(s.localPath || '/data/backups', `This server (${s.localPath || '/data/backups'})`);
}

/** docker-compose lines that mount the NFS export at /data/backups-nfs (Docker mounts it, not Trigon). */
export function nfsCompose(server: string, exportPath: string) {
  const host = server || '<nas-address>';
  const path = exportPath || '/volume1/backups/trigon';
  return `# 1) under the api service's "volumes:" list, add:
      - trigon-backups-nfs:/data/backups-nfs

# 2) at the end of docker-compose.yml, add:
volumes:
  trigon-backups-nfs:
    driver: local
    driver_opts:
      type: nfs
      o: addr=${host},rw,nfsvers=4
      device: ":${path}"`;
}
