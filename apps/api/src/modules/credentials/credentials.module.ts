import { Module } from "@nestjs/common";
import { DeleteCredentialHandler, SetCredentialHandler } from "./application/commands/credential-commands.ts";
import { ListCredentialsHandler } from "./application/queries/list-credentials.ts";
import { CredentialsController } from "./presentation/credentials.controller.ts";

@Module({ controllers: [CredentialsController], providers: [SetCredentialHandler, DeleteCredentialHandler, ListCredentialsHandler] })
export class CredentialsModule {}
