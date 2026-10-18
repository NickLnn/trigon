import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Failures counted within this window. */
export const FAILURE_WINDOW_MS = 15 * 60_000;
/** Free attempts before sign-in for that account starts being paused. */
export const FREE_FAILURES = 5;
/** First pause; doubles with every further failure, capped at MAX_LOCK_MS. */
export const BASE_LOCK_MS = 30_000;
export const MAX_LOCK_MS = 15 * 60_000;

interface Entry {
  failures: number[];
  lockedUntil: number;
}

/**
 * Per-account brute-force protection, on top of the per-IP throttle: after FREE_FAILURES wrong
 * passwords for one account (whatever IP they come from), further attempts are refused for an
 * exponentially growing pause. Keyed by the normalised login name, so it also covers names that
 * don't exist (no account enumeration). In memory — Trigon runs as a single API instance.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly entries = new Map<string, Entry>();
  /** Clock; replaced in tests. */
  now: () => number = Date.now;

  static key(method: 'local' | 'ldap', identifier: string) {
    return `${method}:${identifier.trim().toLowerCase().slice(0, 320)}`;
  }

  /** Milliseconds until another attempt is allowed (0 = allowed now). */
  retryAfter(key: string): number {
    const e = this.entries.get(key);
    return e ? Math.max(0, e.lockedUntil - this.now()) : 0;
  }

  /** Throw 429 while the account is paused. */
  assertAllowed(key: string) {
    const wait = this.retryAfter(key);
    if (wait > 0) {
      throw new HttpException(
        `Too many failed sign-ins for this account. Try again in ${Math.ceil(wait / 60_000)} minute${wait > 60_000 ? 's' : ''}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Record a failure; returns true when this failure started (or extended) a pause. */
  fail(key: string): boolean {
    const now = this.now();
    const e = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    e.failures = [...e.failures.filter((t) => now - t < FAILURE_WINDOW_MS), now];
    const over = e.failures.length - FREE_FAILURES;
    if (over >= 0) e.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** over);
    this.entries.set(key, e);
    this.sweep(now);
    return over >= 0;
  }

  succeed(key: string) {
    this.entries.delete(key);
  }

  private sweep(now: number) {
    if (this.entries.size < 10_000) return;
    for (const [k, e] of this.entries) {
      if (e.lockedUntil < now && e.failures.every((t) => now - t >= FAILURE_WINDOW_MS)) this.entries.delete(k);
    }
  }
}
