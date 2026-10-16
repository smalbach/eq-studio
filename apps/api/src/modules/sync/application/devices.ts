/**
 * Signing a device in from the browser (the device authorization flow of RFC 8628, trimmed):
 * the device asks for a code, a signed-in person approves it for a workspace, and the device
 * collects a token of its own. The token acts as that person in that workspace, with the role
 * they hold there at each request: removing them from the workspace cuts the device off too.
 */
import { randomInt } from "node:crypto";
import { Inject } from "@nestjs/common";
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { ApiTokenRow, DeviceCodeRow } from "../../../database/entities.ts";
import { randomToken, sha256 } from "../../../shared/auth-crypto.ts";
import { Forbidden, Invalid, NotFound } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import type { Actor } from "../../../shared/rbac.ts";
import { AccountsRepository } from "../../accounts/infrastructure/accounts.repository.ts";
import { SyncStore } from "../infrastructure/sync.store.ts";

const LIFETIME_MS = 15 * 60_000;
const INTERVAL_SECONDS = 3;
// No vowels (no words), no 0/O or 1/I: easy to read aloud and to type.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
const userCode = () => Array.from({ length: 8 }, (_, index) => `${index === 4 ? "-" : ""}${ALPHABET[randomInt(ALPHABET.length)]}`).join("");
export const normalizeUserCode = (code: string) => { const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, ""); return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean; };

export class StartDeviceCommand { constructor(readonly name: string, readonly origin: string) {} }

@CommandHandler(StartDeviceCommand)
export class StartDeviceHandler implements ICommandHandler<StartDeviceCommand> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ name, origin }: StartDeviceCommand) {
    await this.store.purgeDeviceCodes();
    const deviceCode = randomToken("eqdc");
    const row: DeviceCodeRow = { id: uuidv7(), deviceCodeHash: sha256(deviceCode), userCode: userCode(), name: name.slice(0, 200), status: "pending", workspaceId: null, userId: null, expiresAt: new Date(Date.now() + LIFETIME_MS).toISOString(), createdAt: isoNow() };
    await this.store.saveDeviceCode(row);
    return { deviceCode, userCode: row.userCode, verificationUri: `${origin}/?device=${row.userCode}`, expiresIn: LIFETIME_MS / 1000, interval: INTERVAL_SECONDS };
  }
}

export class CollectDeviceTokenCommand { constructor(readonly deviceCode: string) {} }

/** The device's poll: pending, gone, or — once — its token. */
@CommandHandler(CollectDeviceTokenCommand)
export class CollectDeviceTokenHandler implements ICommandHandler<CollectDeviceTokenCommand> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore, @Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ deviceCode }: CollectDeviceTokenCommand): Promise<{ status: "pending" | "expired" | "denied" } | { status: "approved"; token: string; workspace: { id: string; name: string } }> {
    const row = await this.store.deviceCodeByHash(sha256(deviceCode));
    if (!row || row.status === "used" || row.expiresAt <= isoNow()) return { status: "expired" };
    if (row.status === "denied") return { status: "denied" };
    if (row.status === "pending") return { status: "pending" };
    if (!await this.store.claimDeviceCode(row.id)) return { status: "expired" };
    const membership = (await this.accounts.membershipsOf(row.userId!)).find((item) => item.workspaceId === row.workspaceId);
    if (!membership) return { status: "denied" };
    const token = randomToken("eqt");
    const tokenRow: ApiTokenRow = { id: uuidv7(), workspaceId: row.workspaceId!, kind: "device", userId: row.userId, name: `Device · ${row.name}`.slice(0, 200), tokenHash: sha256(token), prefix: token.slice(0, 12), role: membership.role, createdBy: row.userId!, lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: isoNow() };
    await this.accounts.saveApiToken(tokenRow);
    const workspace = await this.accounts.workspace(row.workspaceId!);
    return { status: "approved", token, workspace: { id: row.workspaceId!, name: workspace?.name ?? "" } };
  }
}

export class DescribeDeviceQuery { constructor(readonly userCode: string) {} }

@QueryHandler(DescribeDeviceQuery)
export class DescribeDeviceHandler implements IQueryHandler<DescribeDeviceQuery> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ userCode }: DescribeDeviceQuery) {
    const row = await this.store.deviceCodeByUserCode(normalizeUserCode(userCode));
    if (!row || row.status !== "pending" || row.expiresAt <= isoNow()) throw new NotFound("Device code (it may have expired or been used)");
    return { userCode: row.userCode, name: row.name, expiresAt: row.expiresAt };
  }
}

export class DecideDeviceCommand { constructor(readonly userId: string, readonly userCode: string, readonly approve: boolean, readonly workspaceId?: string) {} }

@CommandHandler(DecideDeviceCommand)
export class DecideDeviceHandler implements ICommandHandler<DecideDeviceCommand, void> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore, @Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ userId, userCode, approve, workspaceId }: DecideDeviceCommand) {
    const row = await this.store.deviceCodeByUserCode(normalizeUserCode(userCode));
    if (!row || row.status !== "pending" || row.expiresAt <= isoNow()) throw new NotFound("Device code (it may have expired or been used)");
    if (!approve) { await this.store.saveDeviceCode({ ...row, status: "denied" }); return; }
    if (!workspaceId) throw new Invalid("Choose the workspace the device syncs with");
    const membership = (await this.accounts.membershipsOf(userId)).find((item) => item.workspaceId === workspaceId);
    if (!membership) throw new Forbidden("You are not a member of this workspace");
    await this.store.saveDeviceCode({ ...row, status: "approved", workspaceId, userId });
  }
}

export class ForgetDeviceCommand { constructor(readonly actor: Actor) {} }

/** A device unlinking itself revokes its own token. */
@CommandHandler(ForgetDeviceCommand)
export class ForgetDeviceHandler implements ICommandHandler<ForgetDeviceCommand, void> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async execute({ actor }: ForgetDeviceCommand) {
    if (!actor.tokenId) return;
    const row = (await this.accounts.apiTokens(actor.workspaceId)).find((item) => item.id === actor.tokenId);
    if (row && !row.revokedAt) await this.accounts.saveApiToken({ ...row, revokedAt: isoNow() });
  }
}
