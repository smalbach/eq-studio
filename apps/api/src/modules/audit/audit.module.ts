import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.ts";

/** The log's reader. `AuditLog` itself is shared by every module (see the persistence module). */
@Module({ controllers: [AuditController] })
export class AuditModule {}
