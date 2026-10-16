import { Module } from "@nestjs/common";
import { CreateProjectHandler } from "./application/commands/create-project.ts";
import { ImportProjectFileHandler } from "./application/commands/import-project-file.ts";
import { ArchiveProjectHandler, UpdateProjectHandler } from "./application/commands/update-project.ts";
import { ExportProjectHandler, GetProjectHandler, ListProjectsHandler } from "./application/queries/project-queries.ts";
import { ProjectsController } from "./presentation/projects.controller.ts";

@Module({
  controllers: [ProjectsController],
  providers: [CreateProjectHandler, ImportProjectFileHandler, UpdateProjectHandler, ArchiveProjectHandler, ListProjectsHandler, GetProjectHandler, ExportProjectHandler],
})
export class ProjectsModule {}
