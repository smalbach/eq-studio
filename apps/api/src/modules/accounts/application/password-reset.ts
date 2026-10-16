/**
 * Forgotten passwords: a single-use link, valid for a short while, sent to the account's email.
 *
 * - Asking for a link answers the same, and takes the same time, whether the email has an
 *   account or not: the email is sent after the answer, never awaited by it.
 * - Only the SHA-256 of the token is stored. Using it spends it — and every other link of the
 *   account — atomically, so two requests with the same link cannot both succeed.
 * - A new password closes every session of the account, as changing it does.
 * - Without SMTP the link cannot reach anyone: the development cloud (`pnpm run cloud`) logs it
 *   as a warning so the flow can be tried; a real deployment logs only that it was not sent.
 */
import { Inject, Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { AppConfig } from "../../../config.ts";
import type { UserRow } from "../../../database/entities.ts";
import { hashPassword, randomToken, sha256 } from "../../../shared/auth-crypto.ts";
import { Conflict, Forbidden, NotFound } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { Mailer } from "../../../shared/mailer.ts";
import { rank, requireRole, type Actor } from "../../../shared/rbac.ts";
import { APP_CONFIG } from "../../../shared/tokens.ts";
import { AuditLog } from "../../audit/audit-log.ts";
import { AccountsRepository } from "../infrastructure/accounts.repository.ts";
import { checkPassword } from "./accounts-commands.ts";

export const RESET_TTL_MINUTES = 30;
const logger = new Logger("PasswordReset");

/** The address people open: configured, or the development cloud's own. Never a request's Host. */
export const publicUrlOf = (config: AppConfig) => config.publicUrl ?? `http://localhost:${config.port || 4400}`;
export const resetLink = (config: AppConfig, token: string) => `${publicUrlOf(config)}/?restablecer=${encodeURIComponent(token)}`;

async function createReset(accounts: AccountsRepository, user: UserRow, createdBy: string | null) {
  const token = randomToken("eqp");
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString();
  await accounts.saveReset({ id: uuidv7(), userId: user.id, tokenHash: sha256(token), createdBy, expiresAt, usedAt: null, createdAt: isoNow() });
  return { token, expiresAt };
}

function resetMail(config: AppConfig, user: UserRow, token: string) {
  const link = resetLink(config, token);
  return {
    to: user.email,
    subject: "Endpoint Quality: restablecer la contraseña / reset your password",
    text: [
      `Hola ${user.name}:`, "", `Para elegir una contraseña nueva abre este enlace (vale ${RESET_TTL_MINUTES} minutos y se usa una sola vez):`, link, "", "Si no lo pediste, ignora este correo: tu contraseña no cambia.",
      "", "—", "",
      `Hi ${user.name},`, "", `To choose a new password open this link (valid for ${RESET_TTL_MINUTES} minutes, single use):`, link, "", "If you did not ask for it, ignore this email: your password stays as it is.",
    ].join("\n"),
  };
}

/** Sends the link, or — with no SMTP — says so in the log (with the link only in the development cloud). */
async function deliver(mailer: Mailer, config: AppConfig, user: UserRow, token: string) {
  if (await mailer.send(resetMail(config, user, token))) return true;
  if (!mailer.configured) {
    if (config.devCloud) logger.warn(`No SMTP configured (EQ_SMTP_URL): the password reset link for ${user.email} is ${resetLink(config, token)}`);
    else logger.warn("A password reset was requested but no SMTP is configured (EQ_SMTP_URL): no email was sent");
  }
  return false;
}

export class RequestPasswordResetCommand { constructor(readonly email: string) {} }

@CommandHandler(RequestPasswordResetCommand)
export class RequestPasswordResetHandler implements ICommandHandler<RequestPasswordResetCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(Mailer) private readonly mailer: Mailer) {}

  async execute({ email }: RequestPasswordResetCommand) {
    const user = await this.accounts.userByEmail(email);
    if (!user || user.status !== "active") return;
    const { token } = await createReset(this.accounts, user, null);
    // Not awaited: an SMTP round trip would tell an existing account from an unknown one.
    void deliver(this.mailer, this.config, user, token);
  }
}

export class ResetPasswordCommand { constructor(readonly token: string, readonly password: string) {} }

@CommandHandler(ResetPasswordCommand)
export class ResetPasswordHandler implements ICommandHandler<ResetPasswordCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ token, password }: ResetPasswordCommand) {
    const row = await this.accounts.resetByHash(sha256(token));
    const now = isoNow();
    const gone = new NotFound("Reset link (it may have expired or been used)");
    if (!row || row.usedAt || row.expiresAt <= now) throw gone;
    checkPassword(password);
    const user = await this.accounts.userById(row.userId);
    if (!user || user.status !== "active") throw gone;
    const passwordHash = await hashPassword(password);
    const spent = await this.accounts.transaction(async (tx) => {
      if (!await this.accounts.claimReset(row.id, now, tx)) return false;
      await this.accounts.spendResets(user.id, now, tx);
      await this.accounts.saveUser({ ...user, passwordHash, updatedAt: now }, tx);
      return true;
    });
    if (!spent) throw gone;
    await this.accounts.revokeUserTokens(user.id, now);
    await this.audit.record({ workspaceId: (await this.accounts.membershipsOf(user.id)).map((item) => item.workspaceId), type: "auth.password.reset", actor: { userId: user.id }, detail: { requestedBy: row.createdBy ? "admin" : "self" } });
  }
}

export class CreateResetLinkCommand { constructor(readonly actor: Actor, readonly userId: string) {} }

/**
 * An admin's reset link for a member who cannot get the email (or when there is no SMTP). With
 * SMTP it is emailed to the member and not shown. Without it, the admin gets the token to pass
 * on — but only for someone below their own role (an owner for anyone), and only if the account
 * belongs to no other workspace: otherwise the link would open workspaces the admin does not run.
 */
@CommandHandler(CreateResetLinkCommand)
export class CreateResetLinkHandler implements ICommandHandler<CreateResetLinkCommand, { sent: boolean; token: string | null; expiresAt: string }> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(Mailer) private readonly mailer: Mailer, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ actor, userId }: CreateResetLinkCommand) {
    requireRole(actor, "admin", "A password reset link");
    const membership = await this.accounts.membership(actor.workspaceId, userId);
    const user = membership && await this.accounts.userById(userId);
    if (!membership || !user) throw new NotFound(`Member ${userId}`);
    if (user.id === actor.userId) throw new Conflict("Change your own password in your account settings");
    if (actor.role !== "owner" && rank(membership.role) >= rank(actor.role)) throw new Forbidden(`Only an owner creates a reset link for an ${membership.role}`);
    const elsewhere = (await this.accounts.membershipsOf(user.id)).some((item) => item.workspaceId !== actor.workspaceId);
    if (!this.mailer.configured && elsewhere) throw new Conflict("This account belongs to other workspaces too: its reset link can only go to its own email. Configure SMTP (EQ_SMTP_URL), or ask the person to use \"Forgot password\"");
    const { token, expiresAt } = await createReset(this.accounts, user, actor.userId ?? actor.tokenId);
    const sent = this.mailer.configured ? await deliver(this.mailer, this.config, user, token) : false;
    await this.audit.record({ workspaceId: actor.workspaceId, type: "auth.password.reset_link_created", actor, target: { type: "user", id: user.id, label: user.email }, detail: { delivery: this.mailer.configured ? "email" : "shown" } });
    return { sent, token: this.mailer.configured ? null : token, expiresAt };
  }
}
