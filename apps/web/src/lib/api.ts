/**
 * Thin fetch wrapper. All calls go to same-origin /api (proxied to NestJS by next.config rewrites),
 * so httpOnly auth cookies flow automatically. A 401 triggers one silent refresh-token rotation.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const doFetch = () =>
    fetch(`/api${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        ...(json !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshOnce())) {
    res = await doFetch();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    const message = (body as { message?: string | string[] })?.message;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : (message ?? res.statusText), body);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** Fetch raw bytes (DOCX/PDF viewers), with the same refresh behaviour. */
export async function apiBlob(path: string): Promise<Blob> {
  let res = await fetch(`/api${path}`, { credentials: 'include' });
  if (res.status === 401 && (await refreshOnce())) res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

export function collabUrl(): string {
  if (process.env.NEXT_PUBLIC_COLLAB_URL) return process.env.NEXT_PUBLIC_COLLAB_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:4001`;
}
