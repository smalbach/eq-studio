import { Inject, Injectable } from "@nestjs/common";
import { IsNull, type DataSource, type EntityManager } from "typeorm";
import { ApiTokenEntity, InvitationEntity, MembershipEntity, PasswordResetEntity, RefreshTokenEntity, UserEntity, WorkspaceEntity, type ApiTokenRow, type InvitationRow, type MembershipRow, type PasswordResetRow, type RefreshTokenRow, type UserRow, type WorkspaceRow } from "../../../database/entities.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

/** Users, memberships, invitations and tokens: the accounts side of the database. */
@Injectable()
export class AccountsRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private m(tx?: EntityManager) { return tx ?? this.db.manager; }
  transaction<T>(work: (tx: EntityManager) => Promise<T>) { return this.db.transaction(work); }

  userCount() { return this.m().getRepository(UserEntity).count(); }
  userByEmail(email: string, tx?: EntityManager) { return this.m(tx).getRepository(UserEntity).findOne({ where: { email: email.toLowerCase() } }); }
  userById(id: string) { return this.m().getRepository(UserEntity).findOne({ where: { id } }); }
  async saveUser(row: UserRow, tx?: EntityManager) { await this.m(tx).getRepository(UserEntity).save(row); }

  workspace(id: string) { return this.m().getRepository(WorkspaceEntity).findOne({ where: { id } }); }
  async saveWorkspace(row: WorkspaceRow, tx?: EntityManager) { await this.m(tx).getRepository(WorkspaceEntity).save(row); }

  membershipsOf(userId: string) { return this.m().getRepository(MembershipEntity).find({ where: { userId }, order: { createdAt: "ASC" } }); }
  membership(workspaceId: string, userId: string, tx?: EntityManager) { return this.m(tx).getRepository(MembershipEntity).findOne({ where: { workspaceId, userId } }); }
  members(workspaceId: string) { return this.m().getRepository(MembershipEntity).find({ where: { workspaceId }, order: { createdAt: "ASC" } }); }
  async saveMembership(row: MembershipRow, tx?: EntityManager) { await this.m(tx).getRepository(MembershipEntity).save(row); }
  async deleteMembership(id: string) { await this.m().getRepository(MembershipEntity).delete({ id }); }
  ownerCount(workspaceId: string) { return this.m().getRepository(MembershipEntity).count({ where: { workspaceId, role: "owner" } }); }

  pendingInvitationsFor(email: string) { return this.m().getRepository(InvitationEntity).find({ where: { email: email.toLowerCase(), acceptedAt: IsNull() }, order: { createdAt: "ASC" } }); }
  invitationByHash(tokenHash: string) { return this.m().getRepository(InvitationEntity).findOne({ where: { tokenHash } }); }
  invitations(workspaceId: string) { return this.m().getRepository(InvitationEntity).find({ where: { workspaceId, acceptedAt: IsNull() }, order: { createdAt: "DESC" } }); }
  async saveInvitation(row: InvitationRow, tx?: EntityManager) { await this.m(tx).getRepository(InvitationEntity).save(row); }
  async deleteInvitation(workspaceId: string, id: string) { return (await this.m().getRepository(InvitationEntity).delete({ workspaceId, id })).affected ?? 0; }

  refreshByHash(tokenHash: string) { return this.m().getRepository(RefreshTokenEntity).findOne({ where: { tokenHash } }); }
  async saveRefresh(row: RefreshTokenRow, tx?: EntityManager) { await this.m(tx).getRepository(RefreshTokenEntity).save(row); }
  async revokeFamily(familyId: string, at: string) { await this.m().getRepository(RefreshTokenEntity).update({ familyId, revokedAt: IsNull() }, { revokedAt: at }); }
  async revokeUserTokens(userId: string, at: string) { await this.m().getRepository(RefreshTokenEntity).update({ userId, revokedAt: IsNull() }, { revokedAt: at }); }

  async saveReset(row: PasswordResetRow) { await this.m().getRepository(PasswordResetEntity).save(row); }
  resetByHash(tokenHash: string) { return this.m().getRepository(PasswordResetEntity).findOne({ where: { tokenHash } }); }
  /** Spends a reset token: `true` for the one request that got it, even if two arrive at once. */
  async claimReset(id: string, at: string, tx?: EntityManager) { return ((await this.m(tx).getRepository(PasswordResetEntity).update({ id, usedAt: IsNull() }, { usedAt: at })).affected ?? 0) > 0; }
  /** Every other link of the account stops working once one is used. */
  async spendResets(userId: string, at: string, tx?: EntityManager) { await this.m(tx).getRepository(PasswordResetEntity).update({ userId, usedAt: IsNull() }, { usedAt: at }); }

  apiTokenById(id: string) { return this.m().getRepository(ApiTokenEntity).findOne({ where: { id } }); }
  apiTokenByHash(tokenHash: string) { return this.m().getRepository(ApiTokenEntity).findOne({ where: { tokenHash } }); }
  apiTokens(workspaceId: string) { return this.m().getRepository(ApiTokenEntity).find({ where: { workspaceId }, order: { createdAt: "DESC" } }); }
  async saveApiToken(row: ApiTokenRow) { await this.m().getRepository(ApiTokenEntity).save(row); }
}
