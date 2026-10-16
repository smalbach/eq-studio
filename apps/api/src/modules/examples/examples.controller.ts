import { Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProjectFile, type ProjectFile } from "@eq/runner-core";
import type { AppConfig } from "../../config.ts";
import { NotFound } from "../../shared/errors.ts";
import { APP_CONFIG } from "../../shared/tokens.ts";
import { Workspace } from "../../shared/workspace.ts";
import { Requires } from "../../shared/rbac.ts";
import { ImportProjectFileCommand } from "../projects/application/commands/import-project-file.ts";

type Example = { id: string; file: ProjectFile; readme: string };

/**
 * The example projects shipped with the product (`examples/<id>/<id>.eq.json` and its README),
 * so the first-run guide can offer one without the user finding a file.
 */
@Controller("v1/examples")
export class ExamplesController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(CommandBus) private readonly commands: CommandBus) {}

  private examples(): Example[] {
    const directory = this.config.examplesDir;
    if (!directory || !existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
      const file = join(directory, entry.name, `${entry.name}.eq.json`);
      if (!existsSync(file)) return [];
      try {
        const readme = join(directory, entry.name, "README.md");
        return [{ id: entry.name, file: parseProjectFile(readFileSync(file, "utf8")), readme: existsSync(readme) ? readFileSync(readme, "utf8") : "" }];
      } catch { return []; }
    });
  }

  @Get()
  list() {
    return this.examples().map(({ id, file, readme }) => ({ id, name: file.project.name, operations: file.project.operations.length, environments: file.environments.map((environment) => ({ id: environment.id, name: environment.name, baseUrl: environment.baseUrl })), summary: readme.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim() ?? "" }));
  }

  @Get(":id")
  get(@Param("id") id: string) {
    const example = this.examples().find((item) => item.id === id);
    if (!example) throw new NotFound(`Example ${id}`);
    return example;
  }

  @Requires("editor")
  @Post(":id/import")
  import(@Workspace() workspaceId: string, @Param("id") id: string) {
    const example = this.examples().find((item) => item.id === id);
    if (!example) throw new NotFound(`Example ${id}`);
    return this.commands.execute(new ImportProjectFileCommand(workspaceId, example.file));
  }
}
