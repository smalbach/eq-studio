import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { AppConfig } from "../../../config.ts";
import type { ApiTokenRow, InvitationRow, Role, UserRow } from "../../../database/entities.ts";
import { hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from "../../../shared/auth-crypto.ts";
import { Conflict, Forbidden, Invalid, NotFound, Unauthorized } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { rank, requireRole, type Actor } from "../../../shared/rbac.ts";
import { APP_CONFIG } from "../../../shared/tokens.ts";
import { AccountsRepository } from "../infrastructure/accounts.repository.ts";
import { AuditLog } from "../../audit/audit-log.ts";

export type Session = { accessToken: string; expiresIn: number; refreshToken: string; user: { id: string; email: string; name: string }; workspaces: { id: string; name: string; role: Role }[] };

export const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const MIN_PASSWORD = 10;

/** Issues the pair a sign-in answers with: a short access token and a rotating refresh token. */
export async function issueSession(accounts: AccountsRepository, config: AppConfig, user: UserRow, familyId = uuidv7(), workspaceId?: string): Promise<Session> {
  const memberships = await accounts.membershipsOf(user.id);
  const workspaces = await Promise.all(memberships.map(async (membership) => ({ id: membership.workspaceId, name: (await accounts.workspace(membership.workspaceId))?.name ?? "", role: membership.role })));
  const auth = config.auth!;
  const refreshToken = randomToken("eqr");
  await accounts.saveRefresh({ id: uuidv7(), userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: days(auth.refreshTtlDays), revokedAt: null, replacedBy: null, createdAt: isoNow() });
  return { accessToken: signAccessToken({ sub: user.id, ws: workspaceId ?? workspaces[0]?.id ?? null }, auth.jwtSecret, auth.accessTtlSeconds), expiresIn: auth.accessTtlSeconds, refreshToken, user: { id: user.id, email: user.email, name: user.name }, workspaces };
}

export function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD) throw new Invalid(`The password needs at least ${MIN_PASSWORD} characters`);
}

export class RegisterCommand { constructor(readonly input: { email: string; password: string; name: string; workspace?: string }) {} }

/**
 * A new account and its own workspace, where it is the owner. With invite-only registration
 * (the default) only the very first account can register this way — the one that sets the
 * deployment up; everyone after it arrives through an invitation.
 */
@CommandHandler(RegisterCommand)
export class RegisterHandler implements ICommandHandler<RegisterCommand, Session> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async execute({ input }: RegisterCommand) {
    if (this.config.auth!.registration !== "open" && (await this.accounts.userCount()) > 0) throw new Forbidden("Registration is by invitation: ask an administrator of your workspace");
    checkPassword(input.password);
    const email = input.email.toLowerCase();
    if (await this.accounts.userByEmail(email)) throw new Conflict("An account with this email already exists");
    const now = isoNow();
    const user: UserRow = { id: uuidv7(), email, name: input.name, passwordHash: await hashPassword(input.password), status: "active", createdAt: now, updatedAt: now };
    const workspaceId = uuidv7();
    await this.accounts.transaction(async (tx) => {
      await this.accounts.saveUser(user, tx);
      await this.accounts.saveWorkspace({ id: workspaceId, name: input.workspace ?? `${input.name}'s workspace`, createdAt: now }, tx);
      await this.accounts.saveMembership({ id: uuidv7(), workspaceId, userId: user.id, role: "owner", createdAt: now }, tx);
    });
    return issueSession(this.accounts, this.config, user, undefined, workspaceId);
  }
}

export class LoginCommand { constructor(readonly email: string, readonly password: string) {} }

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand, Session> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ email, password }: LoginCommand) {
    const user = await this.accounts.userByEmail(email);
    // The same answer, and the same work, whether the email exists or not.
    const valid = await verifyPassword(password, user?.passwordHash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    if (!user || !valid || user.status !== "active") {
      // An unknown email has no workspace to log it in; the rate limit still counts it.
      if (user) await this.audit.record({ workspaceId: (await this.accounts.membershipsOf(user.id)).map((item) => item.workspaceId), type: "auth.sign_in.failed", actor: { userId: user.id }, detail: { method: "password", reason: valid ? "disabled" : "wrong_password" } });
      throw new Unauthorized("Wrong email or password");
    }
    const session = await issueSession(this.accounts, this.config, user);
    await this.audit.record({ workspaceId: session.workspaces.map((item) => item.id), type: "auth.sign_in.succeeded", actor: { userId: user.id }, detail: { method: "password" } });
    return session;
  }
}

export class RefreshCommand { constructor(readonly refreshToken: string, readonly workspaceId?: string) {} }

/**
 * A new pair for a valid refresh token, which is spent in the process. Presenting a token that
 * was already spent means it was copied: the whole family is revoked, so both the thief and the
 * user have to sign in again.
 */
@CommandHandler(RefreshCommand)
export class RefreshHandler implements ICommandHandler<RefreshCommand, Session> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async execute({ refreshToken, workspaceId }: RefreshCommand) {
    const row = await this.accounts.refreshByHash(sha256(refreshToken));
    const now = isoNow();
    if (!row) throw new Unauthorized("Sign in again");
    if (row.revokedAt) { await this.accounts.revokeFamily(row.familyId, now); throw new Unauthorized("This session was used elsewhere and has been closed; sign in again"); }
    if (row.expiresAt <= now) throw new Unauthorized("The session expired; sign in again");
    const user = await this.accounts.userById(row.userId);
    if (!user || user.status !== "active") throw new Unauthorized("The account is not active");
    const session = await issueSession(this.accounts, this.config, user, row.familyId, workspaceId);
    const next = await this.accounts.refreshByHash(sha256(session.refreshToken));
    await this.accounts.saveRefresh({ ...row, revokedAt: now, replacedBy: next!.id });
    return session;
  }
}

export class LogoutCommand { constructor(readonly refreshToken: string) {} }

@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ refreshToken }: LogoutCommand) {
    const row = await this.accounts.refreshByHash(sha256(refreshToken));
    if (row) await this.accounts.revokeFamily(row.familyId, isoNow());
  }
}

export class ChangePasswordCommand { constructor(readonly userId: string, readonly current: string, readonly next: string) {} }

/** A new password closes every other session of the account. */
@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<ChangePasswordCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ userId, current, next }: ChangePasswordCommand) {
    const user = await this.accounts.userById(userId);
    if (!user || !(await verifyPassword(current, user.passwordHash))) throw new Unauthorized("The current password is wrong");
    checkPassword(next);
    await this.accounts.saveUser({ ...user, passwordHash: await hashPassword(next), updatedAt: isoNow() });
    await this.accounts.revokeUserTokens(user.id, isoNow());
    await this.audit.record({ workspaceId: (await this.accounts.membershipsOf(user.id)).map((item) => item.workspaceId), type: "auth.password.changed", actor: { userId: user.id } });
  }
}

export class CreateWorkspaceCommand { constructor(readonly userId: string, readonly name: string) {} }

@CommandHandler(CreateWorkspaceCommand)
export class CreateWorkspaceHandler implements ICommandHandler<CreateWorkspaceCommand, { id: string }> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ userId, name }: CreateWorkspaceCommand) {
    const id = uuidv7();
    const now = isoNow();
    await this.accounts.transaction(async (tx) => {
      await this.accounts.saveWorkspace({ id, name, createdAt: now }, tx);
      await this.accounts.saveMembership({ id: uuidv7(), workspaceId: id, userId, role: "owner", createdAt: now }, tx);
    });
    return { id };
  }
}

export class InviteMemberCommand { constructor(readonly actor: Actor, readonly email: string, readonly role: Role) {} }

/** An invitation link, valid for seven days. Nobody can invite into a role above their own. */
@CommandHandler(InviteMemberCommand)
export class InviteMemberHandler implements ICommandHandler<InviteMemberCommand, { id: string; token: string; expiresAt: string }> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ actor, email, role }: InviteMemberCommand) {
    if (rank(role) > rank(actor.role)) throw new Forbidden(`You cannot invite an ${role}: it is above your own role`);
    const token = randomToken("eqi");
    const row: InvitationRow = { id: uuidv7(), workspaceId: actor.workspaceId, email: email.toLowerCase(), role, tokenHash: sha256(token), expiresAt: days(7), acceptedAt: null, createdBy: actor.userId ?? actor.tokenId ?? "", createdAt: isoNow() };
    await this.accounts.saveInvitation(row);
    await this.audit.record({ workspaceId: actor.workspaceId, type: "member.invited", actor, target: { type: "invitation", id: row.id, label: row.email }, detail: { role } });
    return { id: row.id, token, expiresAt: row.expiresAt };
  }
}

export class AcceptInvitationCommand { constructor(readonly token: string, readonly password: string, readonly name?: string) {} }

/**
 * Joins the invited workspace. A new email creates the account with the given password; an
 * existing account proves it is its own by that same password.
 */
@CommandHandler(AcceptInvitationCommand)
export class AcceptInvitationHandler implements ICommandHandler<AcceptInvitationCommand, Session> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ token, password, name }: AcceptInvitationCommand) {
    const invitation = await this.accounts.invitationByHash(sha256(token));
    const now = isoNow();
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= now) throw new NotFound("Invitation (it may have expired or been used)");
    let user = await this.accounts.userByEmail(invitation.email);
    if (user && !(await verifyPassword(password, user.passwordHash))) throw new Unauthorized("Wrong password for this account");
    if (!user) {
      checkPassword(password);
      user = { id: uuidv7(), email: invitation.email, name: name ?? invitation.email.split("@")[0], passwordHash: await hashPassword(password), status: "active", createdAt: now, updatedAt: now };
    }
    const account = user;
    await this.accounts.transaction(async (tx) => {
      await this.accounts.saveUser(account, tx);
      const existing = await this.accounts.membership(invitation.workspaceId, account.id, tx);
      if (!existing) await this.accounts.saveMembership({ id: uuidv7(), workspaceId: invitation.workspaceId, userId: account.id, role: invitation.role, createdAt: now }, tx);
      await this.accounts.saveInvitation({ ...invitation, acceptedAt: now }, tx);
    });
    await this.audit.record({ workspaceId: invitation.workspaceId, type: "member.joined", actor: { userId: account.id }, target: { type: "user", id: account.id, label: account.email }, detail: { role: invitation.role } });
    return issueSession(this.accounts, this.config, account, undefined, invitation.workspaceId);
  }
}

export class ChangeRoleCommand { constructor(readonly actor: Actor, readonly userId: string, readonly role: Role) {} }

/** Only owners change roles, and a workspace never loses its last owner. */
@CommandHandler(ChangeRoleCommand)
export class ChangeRoleHandler implements ICommandHandler<ChangeRoleCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ actor, userId, role }: ChangeRoleCommand) {
    requireRole(actor, "owner", "Changing a role");
    const membership = await this.accounts.membership(actor.workspaceId, userId);
    if (!membership) throw new NotFound(`Member ${userId}`);
    if (membership.role === "owner" && role !== "owner" && (await this.accounts.ownerCount(actor.workspaceId)) <= 1) throw new Conflict("The workspace needs at least one owner");
    await this.accounts.saveMembership({ ...membership, role });
    await this.audit.record({ workspaceId: actor.workspaceId, type: "member.role_changed", actor, target: { type: "user", id: userId, label: (await this.accounts.userById(userId))?.email }, detail: { from: membership.role, to: role } });
  }
}

export class RemoveMemberCommand { constructor(readonly actor: Actor, readonly userId: string) {} }

/** Admins remove members; only an owner removes an owner, and never the last one. */
@CommandHandler(RemoveMemberCommand)
export class RemoveMemberHandler implements ICommandHandler<RemoveMemberCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ actor, userId }: RemoveMemberCommand) {
    const membership = await this.accounts.membership(actor.workspaceId, userId);
    if (!membership) throw new NotFound(`Member ${userId}`);
    if (membership.role === "owner") {
      requireRole(actor, "owner", "Removing an owner");
      if ((await this.accounts.ownerCount(actor.workspaceId)) <= 1) throw new Conflict("The workspace needs at least one owner");
    }
    await this.accounts.deleteMembership(membership.id);
    await this.audit.record({ workspaceId: actor.workspaceId, type: "member.removed", actor, target: { type: "user", id: userId, label: (await this.accounts.userById(userId))?.email }, detail: { role: membership.role } });
  }
}

export class IssueApiTokenCommand { constructor(readonly actor: Actor, readonly name: string, readonly role: Role, readonly expiresInDays?: number) {} }

/**
 * A token for CI and scripts, bound to this workspace and to a role no higher than the issuer's.
 * The token is shown once; only its hash and first characters are kept.
 */
@CommandHandler(IssueApiTokenCommand)
export class IssueApiTokenHandler implements ICommandHandler<IssueApiTokenCommand, { id: string; token: string }> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ actor, name, role, expiresInDays }: IssueApiTokenCommand) {
    if (rank(role) > rank(actor.role)) throw new Forbidden(`A token cannot have a role above yours (${actor.role})`);
    if (role === "owner") throw new Invalid("API tokens act at most as admin: ownership stays with people");
    const token = randomToken("eqt");
    const row: ApiTokenRow = { id: uuidv7(), workspaceId: actor.workspaceId, name, tokenHash: sha256(token), prefix: token.slice(0, 12), role, createdBy: actor.userId ?? actor.tokenId ?? "", lastUsedAt: null, expiresAt: expiresInDays ? days(expiresInDays) : null, revokedAt: null, createdAt: isoNow() };
    await this.accounts.saveApiToken(row);
    await this.audit.record({ workspaceId: actor.workspaceId, type: "api_token.created", actor, target: { type: "api_token", id: row.id, label: name }, detail: { role, prefix: row.prefix, expiresAt: row.expiresAt } });
    return { id: row.id, token };
  }
}

export class RevokeApiTokenCommand { constructor(readonly actor: Actor, readonly id: string) {} }

@CommandHandler(RevokeApiTokenCommand)
export class RevokeApiTokenHandler implements ICommandHandler<RevokeApiTokenCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ actor, id }: RevokeApiTokenCommand) {
    const row = (await this.accounts.apiTokens(actor.workspaceId)).find((item) => item.id === id);
    if (!row) throw new NotFound(`API token ${id}`);
    if (row.revokedAt) return;
    await this.accounts.saveApiToken({ ...row, revokedAt: isoNow() });
    await this.audit.record({ workspaceId: actor.workspaceId, type: row.kind === "device" ? "device.unlinked" : "api_token.revoked", actor, target: { type: row.kind === "device" ? "device" : "api_token", id: row.id, label: row.name }, detail: { prefix: row.prefix } });
  }
}

export class CancelInvitationCommand { constructor(readonly workspaceId: string, readonly id: string) {} }

@CommandHandler(CancelInvitationCommand)
export class CancelInvitationHandler implements ICommandHandler<CancelInvitationCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ workspaceId, id }: CancelInvitationCommand) {
    if (!await this.accounts.deleteInvitation(workspaceId, id)) throw new NotFound(`Invitation ${id}`);
  }
}
