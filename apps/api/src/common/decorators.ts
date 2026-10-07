import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { SystemRole } from '@trigon/shared';

export interface AuthUser {
  id: string;
  email: string;
  role: SystemRole;
}

export const IS_PUBLIC = 'isPublic';
/** Skip the global JWT guard for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restrict a route to the given system roles (checked by RolesGuard). */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES, roles);

/** The authenticated user attached by the JWT strategy. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
