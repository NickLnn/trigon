/** Exact origins (scheme://host[:port]) allowed to call the API cross-origin with credentials. */
export function allowedOrigins(...urls: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const raw of urls.length && urls.some(Boolean) ? urls : ['http://localhost:3000']) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.origin);
    } catch {
      /* not a URL: ignored */
    }
  }
  return out;
}
