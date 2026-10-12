import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** Where the current HTTP request came from — read by the activity log without threading `req` everywhere. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = () => storage.getStore();

/** Express middleware: makes the client address available to everything the request calls. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  storage.run({ ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 400) ?? null }, next);
}
