/** Smallest accepted length for signing / encryption secrets (48 random bytes as base64url is 64). */
export const MIN_SECRET_LENGTH = 32;

const PLACEHOLDERS = /^(change-?me|changeit|secret|password|trigon|test|dev|example|jwt[-_]?secret)/i;

/** Why a secret is unusable, or null when it is fine. */
export function weakSecretReason(value: string | undefined): string | null {
  if (!value) return 'is not set';
  if (value.length < MIN_SECRET_LENGTH) return `is shorter than ${MIN_SECRET_LENGTH} characters`;
  if (PLACEHOLDERS.test(value)) return 'looks like a placeholder';
  if (new Set(value).size < 10) return 'has too little variety to be random';
  return null;
}

const GENERATE = `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;

/**
 * ConfigModule `validate` hook: refuse to start with a missing or weak JWT secret (it signs every
 * session) or settings encryption key, instead of running with forgeable tokens.
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const problems: string[] = [];
  const jwt = weakSecretReason(env.JWT_ACCESS_SECRET as string | undefined);
  if (jwt) problems.push(`JWT_ACCESS_SECRET ${jwt}.`);
  const settingsKey = env.SETTINGS_ENCRYPTION_KEY as string | undefined;
  if (settingsKey) {
    const reason = weakSecretReason(settingsKey);
    if (reason) problems.push(`SETTINGS_ENCRYPTION_KEY ${reason}.`);
    if (settingsKey === env.JWT_ACCESS_SECRET) problems.push('SETTINGS_ENCRYPTION_KEY must differ from JWT_ACCESS_SECRET.');
  }
  // The sample database password must never reach a real install (Docker images run with NODE_ENV=production).
  const dbPassword = String(env.PGPASSWORD ?? '') || (/^postgres(ql)?:\/\/[^:/]*:([^@]*)@/.exec(String(env.DATABASE_URL ?? ''))?.[2] ?? '');
  if (env.NODE_ENV === 'production' && /^change-?me$/i.test(decodeURIComponent(dbPassword))) {
    problems.push('The database password is still "change-me" (POSTGRES_PASSWORD in .env).');
  }
  if (problems.length) throw new Error(`Insecure configuration:\n  - ${problems.join('\n  - ')}\n${GENERATE}`);
  return env;
}
