import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppConfig } from "../config.ts";
import type { Role } from "../database/entities.ts";
import { AccountsRepository } from "../modules/accounts/infrastructure/accounts.repository.ts";
import { sha256, verifyAccessToken } from "./auth-crypto.ts";
import { Forbidden, Unauthorized } from "./errors.ts";
import { isoNow } from "./ids.ts";
import { ACCOUNT_KEY, LOCAL_ACTOR, PUBLIC_KEY, rank, ROLE_KEY, type Actor } from "./rbac.ts";
import { APP_CONFIG } from "./tokens.ts";

type Request = { method: string; path: string; headers: Record<string, string | string[] | undefined>; query: Record<string, unknown>; actor?: Actor; userId?: string };

/**
 * Every request, before it reaches a controller: who is it, in which workspace, with which role.
 *
 * Local mode has one implicit owner and no sign-in. With authentication required, a request
 * carries either a user's access token (a short-lived JWT; the workspace from `X-Workspace`, or
 * the one the token was issued for) or an API token (`eqt_…`, bound to one workspace and role).
 * The event stream cannot send headers from a browser, so only its route also reads the token
 * from `?access_token=`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    if (!this.config.auth?.required) { request.actor = LOCAL_ACTOR; return true; }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const token = this.tokenOf(request);
    if (!token) throw new Unauthorized();
    const accountOnly = this.reflector.getAllAndOverride<boolean>(ACCOUNT_KEY, targets);
    const actor = token.startsWith("eqt_") ? await this.fromApiToken(token, accountOnly) : await this.fromAccessToken(token, request, accountOnly);
    if (accountOnly) return true;
    request.actor = actor!;
    const required = this.reflector.getAllAndOverride<Role>(ROLE_KEY, targets) ?? (request.method === "GET" ? "viewer" : "admin");
    if (rank(actor!.role) < rank(required)) throw new Forbidden(`This needs the ${required} role; you are ${actor!.role}`);
    return true;
  }

  private tokenOf(request: Request) {
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (value?.toLowerCase().startsWith("bearer ")) return value.slice(7).trim();
    if (request.method === "GET" && request.path.endsWith("/stream") && typeof request.query.access_token === "string") return request.query.access_token;
    return null;
  }

  private async fromApiToken(token: string, accountOnly: boolean): Promise<Actor | null> {
    if (accountOnly) throw new Forbidden("API tokens act in a workspace; this route is for signed-in users");
    const row = await this.accounts.apiTokenByHash(sha256(token));
    const now = isoNow();
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) throw new Unauthorized("The API token is not valid");
    // At most once a minute: a busy pipeline should not turn every request into a write.
    if (!row.lastUsedAt || Date.parse(now) - Date.parse(row.lastUsedAt) > 60_000) await this.accounts.saveApiToken({ ...row, lastUsedAt: now });
    // A device acts as the person who signed it in, with the role they hold now.
    if (row.kind === "device") {
      const membership = row.userId ? (await this.accounts.membershipsOf(row.userId)).find((item) => item.workspaceId === row.workspaceId) : undefined;
      if (!membership) throw new Unauthorized("This device's account is no longer in the workspace");
      return { workspaceId: row.workspaceId, role: membership.role, userId: row.userId!, tokenId: row.id, local: false };
    }
    return { workspaceId: row.workspaceId, role: row.role, userId: null, tokenId: row.id, local: false };
  }

  private async fromAccessToken(token: string, request: Request, accountOnly: boolean): Promise<Actor | null> {
    const claims = verifyAccessToken(token, this.config.auth!.jwtSecret);
    if (!claims) throw new Unauthorized("The session expired; sign in again");
    const user = await this.accounts.userById(claims.sub);
    if (!user || user.status !== "active") throw new Unauthorized("The account is not active");
    request.userId = user.id;
    if (accountOnly) return null;
    const header = request.headers["x-workspace"];
    const fromQuery = request.path.endsWith("/stream") && typeof request.query.workspace === "string" ? request.query.workspace : undefined;
    const wanted = (Array.isArray(header) ? header[0] : header) ?? fromQuery ?? claims.ws;
    const memberships = await this.accounts.membershipsOf(user.id);
    const membership = wanted ? memberships.find((item) => item.workspaceId === wanted) : memberships[0];
    // Not a member is the same answer as "no such workspace": nothing to learn by probing ids.
    if (!membership) throw new Forbidden("You are not a member of this workspace");
    return { workspaceId: membership.workspaceId, role: membership.role, userId: user.id, tokenId: null, local: false };
  }
}
