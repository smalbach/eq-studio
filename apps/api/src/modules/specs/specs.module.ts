import { Module } from "@nestjs/common";
import { ActivateSpecVersionHandler, ImportSpecVersionHandler } from "./application/commands/spec-commands.ts";
import { GetOperationsHandler, ListSpecVersionsHandler } from "./application/queries/spec-queries.ts";
import { SpecsController } from "./presentation/specs.controller.ts";

@Module({ controllers: [SpecsController], providers: [ImportSpecVersionHandler, ActivateSpecVersionHandler, ListSpecVersionsHandler, GetOperationsHandler] })
export class SpecsModule {}
