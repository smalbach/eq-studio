import { Module } from "@nestjs/common";
import { ActivateSpecVersionHandler, ImportSpecVersionHandler } from "./application/commands/spec-commands.ts";
import { GetOperationsHandler, GetSpecDiffHandler, ListSpecVersionsHandler } from "./application/queries/spec-queries.ts";
import { SpecDiffer } from "./application/spec-differ.ts";
import { SpecsController } from "./presentation/specs.controller.ts";

@Module({ controllers: [SpecsController], providers: [ImportSpecVersionHandler, ActivateSpecVersionHandler, ListSpecVersionsHandler, GetOperationsHandler, GetSpecDiffHandler, SpecDiffer] })
export class SpecsModule {}
