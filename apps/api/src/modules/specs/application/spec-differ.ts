import { Inject, Injectable } from "@nestjs/common";
import { diffSpecs, type ProjectOperation, type SpecDiff } from "@eq/runner-core";
import type { ProjectRow, SpecVersionRow } from "../../../database/entities.ts";
import { Invalid } from "../../../shared/errors.ts";
import { SpecVersionRepository } from "../infrastructure/spec-version.repository.ts";

export type SpecVersionRef = { id: string; version: string | null; title: string | null; createdAt: string };
export type SpecVersionDiff = SpecDiff & { from: SpecVersionRef | null; to: SpecVersionRef | null };

const ref = (row: SpecVersionRow): SpecVersionRef => ({ id: row.id, version: row.version, title: row.title, createdAt: row.createdAt });
const EMPTY: SpecDiff = { changes: [], summary: { breaking: 0, nonBreaking: 0, operationsAdded: 0, operationsRemoved: 0, operationsChanged: 0 } };

/**
 * A version from a project file keeps its operations but no document: it is compared as the
 * document those operations describe — routes, parameters and statuses, no schemas.
 */
function documentFrom(operations: ProjectOperation[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const inPath = new Set([...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]));
    paths[operation.path] ??= {};
    paths[operation.path][operation.method.toLowerCase()] = {
      operationId: operation.id,
      parameters: operation.parameters.map((name) => ({ name, in: inPath.has(name) ? "path" : "query", ...(inPath.has(name) ? { required: true } : {}) })),
      responses: Object.fromEntries(operation.statuses.map((status) => [String(status), { description: "" }])),
    };
  }
  return { openapi: "3.0.0", info: { title: "", version: "" }, paths };
}

/** The changes between two stored versions of a project's contract. */
@Injectable()
export class SpecDiffer {
  constructor(@Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository) {}

  private async document(row: SpecVersionRow) {
    return row.document ? JSON.parse(row.document) as unknown : documentFrom(await this.versions.operations(row.id));
  }

  async between(from: SpecVersionRow, to: SpecVersionRow): Promise<SpecVersionDiff> {
    try {
      return { from: ref(from), to: ref(to), ...diffSpecs(await this.document(from), await this.document(to)) };
    } catch (error) {
      throw new Invalid(error instanceof Error ? error.message : String(error));
    }
  }

  /** `to` defaults to the active version and `from` to the one stored just before `to`; with no such version there is nothing to compare. */
  async forProject(project: ProjectRow, fromId?: string, toId?: string): Promise<SpecVersionDiff> {
    const targetId = toId ?? project.activeSpecVersionId;
    if (!targetId) return { from: null, to: null, ...EMPTY };
    const to = await this.versions.require(project.id, targetId);
    let from: SpecVersionRow | null = null;
    if (fromId) from = await this.versions.require(project.id, fromId);
    else {
      const listed = await this.versions.list(project.id);
      const previous = listed[listed.findIndex((row) => row.id === to.id) + 1];
      if (previous) from = await this.versions.require(project.id, previous.id);
    }
    if (!from) return { from: null, to: ref(to), ...EMPTY };
    return this.between(from, to);
  }
}
