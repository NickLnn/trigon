import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** Where the current HTTP request came from — read by the activity log without threading `req` everywhere. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = () => storage.getStore();

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;
const bare = (ip: string | null | undefined) => (ip ?? '').trim().replace(/^::ffff:/i, '');
const first = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * The visitor's address. The web container's proxy stamps it as X-Trigon-Client-IP (see apps/web/proxy.js);
 * it is only believed when the request arrives from a private address, i.e. from that container.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, peer: string | null | undefined): string | null {
  const direct = bare(peer);
  if (direct && !PRIVATE.test(direct)) return direct;
  const stamped = bare(first(headers['x-trigon-client-ip']));
  const forwarded = bare(first(headers['x-forwarded-for']).split(',')[0]);
  return stamped || forwarded || direct || null;
}

/** Express middleware: makes the client address available to everything the request calls. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  storage.run({ ip: clientIp(req.headers, req.socket.remoteAddress), userAgent: req.headers['user-agent']?.slice(0, 400) ?? null }, next);
}
