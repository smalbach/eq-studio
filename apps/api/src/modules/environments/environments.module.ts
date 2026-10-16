import { Module } from "@nestjs/common";
import { CreateEnvironmentHandler, DeleteEnvironmentHandler, UpdateEnvironmentHandler } from "./application/commands/environment-commands.ts";
import { ListEnvironmentsHandler } from "./application/queries/list-environments.ts";
import { EnvironmentsController } from "./presentation/environments.controller.ts";

@Module({ controllers: [EnvironmentsController], providers: [CreateEnvironmentHandler, UpdateEnvironmentHandler, DeleteEnvironmentHandler, ListEnvironmentsHandler] })
export class EnvironmentsModule {}
