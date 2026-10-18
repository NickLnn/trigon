/** Keys whose values must never reach the audit log or stdout. */
const SENSITIVE = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|verifier/i;
export const REDACTED = '[redacted]';

/** Deep copy of `value` with sensitive keys masked, long strings cut, and depth bounded. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  }
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    // Booleans (has* flags) and the "changed"/"cleared" markers of settingsChanges carry no secret.
    const harmless = v === '' || v === null || typeof v === 'boolean' || v === 'changed' || v === 'cleared';
    out[k] = SENSITIVE.test(k) && !harmless ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

/**
 * What a settings save changed, for the audit log: old → new for ordinary fields, only "changed" /
 * "cleared" for secrets (their values never leave the settings table), and nothing for unchanged fields.
 */
export function settingsChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  secretFields: readonly string[],
  ignore: readonly string[] = [],
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignore.includes(key) || key.startsWith('has')) continue;
    const [a, b] = [before[key], after[key]];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (secretFields.includes(key) || SENSITIVE.test(key)) changes[key] = b ? 'changed' : 'cleared';
    else changes[key] = { from: redact(a ?? null), to: redact(b ?? null) };
  }
  return changes;
}
