import { Module } from "@nestjs/common";
import { AcceptInvitationHandler, ChangePasswordHandler, ChangeRoleHandler, CreateWorkspaceHandler, InviteMemberHandler, IssueApiTokenHandler, LoginHandler, LogoutHandler, RefreshHandler, RegisterHandler, RemoveMemberHandler, RevokeApiTokenHandler, CancelInvitationHandler } from "./application/accounts-commands.ts";
import { RateLimiter } from "../../shared/rate-limit.ts";
import { ApiTokensHandler, CurrentWorkspaceHandler, InvitationsHandler, MeHandler, MembersHandler } from "./application/accounts-queries.ts";
import { CreateResetLinkHandler, RequestPasswordResetHandler, ResetPasswordHandler } from "./application/password-reset.ts";
import { OidcClient, SsoSignInHandler } from "./application/oidc.ts";
import { OidcController } from "./presentation/oidc.controller.ts";
import { AuthController } from "./presentation/auth.controller.ts";
import { WorkspaceController } from "./presentation/workspace.controller.ts";

@Module({
  controllers: [AuthController, WorkspaceController, OidcController],
  providers: [RateLimiter, RegisterHandler, LoginHandler, RefreshHandler, LogoutHandler, ChangePasswordHandler, CreateWorkspaceHandler, InviteMemberHandler, AcceptInvitationHandler, ChangeRoleHandler, RemoveMemberHandler, IssueApiTokenHandler, RevokeApiTokenHandler, CancelInvitationHandler, MeHandler, CurrentWorkspaceHandler, MembersHandler, InvitationsHandler, ApiTokensHandler, RequestPasswordResetHandler, ResetPasswordHandler, CreateResetLinkHandler, OidcClient, SsoSignInHandler],
})
export class AccountsModule {}
