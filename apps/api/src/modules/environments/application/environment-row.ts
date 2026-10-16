import type { EntityManager } from "typeorm";
import type { EnvironmentRow } from "../../../database/entities.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import type { EnvironmentInput } from "../../shared/inputs.ts";
import { slugify } from "../../projects/domain/project.ts";
import type { EnvironmentRepository } from "../infrastructure/environment.repository.ts";

/** A new environment row, with a key that is unique in its project. */
export async function newEnvironment(repository: EnvironmentRepository, workspaceId: string, projectId: string, input: EnvironmentInput, tx: EntityManager): Promise<EnvironmentRow> {
  const base = input.key ?? slugify(input.name);
  let key = base;
  for (let index = 2; await repository.keyTaken(projectId, key, tx); index += 1) key = `${base}-${index}`;
  const now = isoNow();
  return {
    id: uuidv7(), workspaceId, projectId, key, name: input.name, baseUrl: input.baseUrl.replace(/\/+$/, ""), specUrl: input.specUrl ?? null,
    seeded: input.seeded ?? null, writesAllowed: input.writesAllowed ?? null, enforceLatency: input.enforceLatency ?? null, authEnabled: input.authEnabled ?? null,
    description: input.description ?? null, rev: 1, createdAt: now, updatedAt: now, deletedAt: null,
  };
}
