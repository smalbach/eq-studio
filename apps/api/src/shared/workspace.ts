/**
 * The tenant a request acts in. Every row carries a `workspace_id` from the first migration:
 * adding it later would be a data migration with a risk of leaking rows between tenants.
 *
 * Local mode has exactly one workspace, created by the initial migration and used implicitly.
 * Cloud mode resolves it from the authenticated user (P6).
 */
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export const LOCAL_WORKSPACE_ID = "00000000-0000-7000-8000-000000000001";

/** The workspace the authenticated actor acts in; set by the auth guard. */
export const Workspace = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<{ actor?: { workspaceId: string } }>();
  return request.actor?.workspaceId ?? LOCAL_WORKSPACE_ID;
});
