/**
 * Who is asking, and what their role lets them do.
 *
 * | role   | can                                                                          |
 * |--------|------------------------------------------------------------------------------|
 * | viewer | read projects, contracts, environments and runs                              |
 * | editor | edit configuration, import contracts, start read-only runs, probe reads     |
 * | admin  | environments, credentials, runs with writes, load tests, members, API tokens |
 * | owner  | roles, ownership, and everything above                                       |
 *
 * A route says what it needs with `@Requires(role)`. A route that says nothing needs `viewer`
 * for a GET and `admin` for anything else: forgetting the decorator fails closed, never open.
 */
import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Role } from "../database/entities.ts";
import { Forbidden } from "./errors.ts";
import { LOCAL_WORKSPACE_ID } from "./workspace.ts";

export const ROLES: Role[] = ["viewer", "editor", "admin", "owner"];
export const rank = (role: Role) => ROLES.indexOf(role);

export const ROLE_KEY = "eq:role";
export const PUBLIC_KEY = "eq:public";
export const ACCOUNT_KEY = "eq:account";

export const Requires = (role: Role) => SetMetadata(ROLE_KEY, role);
/** Needs nobody: health, login, registration, accepting an invitation. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Needs a signed-in user, not a workspace role: the user's own account and workspaces list. */
export const AccountOnly = () => SetMetadata(ACCOUNT_KEY, true);

export type Actor = { workspaceId: string; role: Role; userId: string | null; tokenId: string | null; local: boolean };

export const LOCAL_ACTOR: Actor = { workspaceId: LOCAL_WORKSPACE_ID, role: "owner", userId: null, tokenId: null, local: true };

export const CurrentActor = createParamDecorator((_: unknown, context: ExecutionContext): Actor => context.switchToHttp().getRequest<{ actor?: Actor }>().actor ?? LOCAL_ACTOR);

/** For decisions that depend on the request's content (a run with writes needs admin). */
export function requireRole(actor: Actor, role: Role, what: string) {
  if (rank(actor.role) < rank(role)) throw new Forbidden(`${what} needs the ${role} role; you are ${actor.role}`);
}

/** The signed-in user's id, on routes that need an account rather than a workspace role. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): string | null => context.switchToHttp().getRequest<{ userId?: string }>().userId ?? null);
