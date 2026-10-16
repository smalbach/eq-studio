import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { NotFound } from "../../../shared/errors.ts";
import type { Actor } from "../../../shared/rbac.ts";
import { AccountsRepository } from "../infrastructure/accounts.repository.ts";

export class MeQuery { constructor(readonly userId: string) {} }

@QueryHandler(MeQuery)
export class MeHandler implements IQueryHandler<MeQuery> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ userId }: MeQuery) {
    const user = await this.accounts.userById(userId);
    if (!user) throw new NotFound("Account");
    const workspaces = await Promise.all((await this.accounts.membershipsOf(user.id)).map(async (membership) => ({ id: membership.workspaceId, name: (await this.accounts.workspace(membership.workspaceId))?.name ?? "", role: membership.role })));
    return { id: user.id, email: user.email, name: user.name, workspaces };
  }
}

export class MembersQuery { constructor(readonly workspaceId: string) {} }

@QueryHandler(MembersQuery)
export class MembersHandler implements IQueryHandler<MembersQuery> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ workspaceId }: MembersQuery) {
    return Promise.all((await this.accounts.members(workspaceId)).map(async (membership) => {
      const user = await this.accounts.userById(membership.userId);
      return { userId: membership.userId, email: user?.email ?? "", name: user?.name ?? "", role: membership.role, since: membership.createdAt };
    }));
  }
}

export class InvitationsQuery { constructor(readonly workspaceId: string) {} }

@QueryHandler(InvitationsQuery)
export class InvitationsHandler implements IQueryHandler<InvitationsQuery> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ workspaceId }: InvitationsQuery) {
    return (await this.accounts.invitations(workspaceId)).map(({ id, email, role, expiresAt, createdAt }) => ({ id, email, role, expiresAt, createdAt }));
  }
}

export class ApiTokensQuery { constructor(readonly workspaceId: string) {} }

/** The tokens of the workspace: never the token itself, only its first characters. */
@QueryHandler(ApiTokensQuery)
export class ApiTokensHandler implements IQueryHandler<ApiTokensQuery> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ workspaceId }: ApiTokensQuery) {
    return (await this.accounts.apiTokens(workspaceId)).map(({ id, kind, name, prefix, role, lastUsedAt, expiresAt, revokedAt, createdAt }) => ({ id, kind: kind ?? "api", name, prefix, role, lastUsedAt, expiresAt, revokedAt, createdAt }));
  }
}

export class CurrentWorkspaceQuery { constructor(readonly actor: Actor) {} }

/** The workspace the request acts in, with the role the caller holds there. */
@QueryHandler(CurrentWorkspaceQuery)
export class CurrentWorkspaceHandler implements IQueryHandler<CurrentWorkspaceQuery> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ actor }: CurrentWorkspaceQuery) {
    const workspace = await this.accounts.workspace(actor.workspaceId);
    if (!workspace) throw new NotFound("Workspace");
    return { id: workspace.id, name: workspace.name, role: actor.role, local: actor.local };
  }
}
