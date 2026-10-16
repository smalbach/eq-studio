import { Module } from "@nestjs/common";
import { GenerateConfigHandler, UpdateConfigSectionHandler } from "./application/commands/config-commands.ts";
import { GetProjectConfigHandler, GetScenariosHandler, PreviewQueueHandler } from "./application/queries/config-queries.ts";
import { ConfigController } from "./presentation/config.controller.ts";

@Module({ controllers: [ConfigController], providers: [UpdateConfigSectionHandler, GenerateConfigHandler, GetProjectConfigHandler, GetScenariosHandler, PreviewQueueHandler] })
export class ProjectConfigModule {}
