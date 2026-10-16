import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { ProjectOperation } from "@eq/runner-core";
import type { ProjectRow, SpecVersionRow } from "../../../database/entities.ts";
import { Invalid } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { SPEC_FETCHER } from "../../../shared/tokens.ts";
import { parseSpec, hashOf, type ParsedSpec } from "../domain/spec.ts";
import type { SpecFetcher } from "../infrastructure/spec-fetcher.ts";
import { SpecVersionRepository } from "../infrastructure/spec-version.repository.ts";

export type SpecSource = { url: string; headers?: Record<string, string> } | { document: string | Record<string, unknown> };

/**
 * Reads a contract and stores it as a spec version. Shared by the commands that create a
 * project and the one that imports a new version, so both store a contract the same way.
 *
 * A document already imported (same content hash) is not stored twice: the existing version is
 * returned. The spec is a snapshot, never a live link — a contract that changes under a run is
 * what the product exists to detect, so it cannot also be how it operates.
 */
@Injectable()
export class SpecImporter {
  constructor(@Inject(SPEC_FETCHER) private readonly fetcher: SpecFetcher, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository) {}

  async read(source: SpecSource): Promise<{ parsed: ParsedSpec; url: string | null }> {
    if ("url" in source) return { parsed: parseSpec(await this.fetcher.fetch(source.url, source.headers)), url: source.url };
    return { parsed: parseSpec(source.document), url: null };
  }

  async store(project: ProjectRow, parsed: ParsedSpec, url: string | null, tx: EntityManager): Promise<{ version: SpecVersionRow; created: boolean }> {
    const existing = await this.versions.findByHash(project.id, parsed.hash, tx);
    if (existing) return { version: existing, created: false };
    const version: SpecVersionRow = { id: uuidv7(), workspaceId: project.workspaceId, projectId: project.id, hash: parsed.hash, sourceKind: url ? "url" : "inline", sourceUrl: url, openapiVersion: parsed.openapiVersion, title: parsed.title, version: parsed.version, document: parsed.text, operationCount: parsed.operations.length, createdAt: isoNow() };
    await this.versions.insert(version, parsed.operations, tx);
    return { version, created: true };
  }

  /** A version that comes from a project file: its operations, with no document behind them. */
  async storeOperations(project: ProjectRow, operations: ProjectOperation[], contractVersion: string | null, tx: EntityManager) {
    if (!operations.length) throw new Invalid("The project file declares no operations");
    const hash = hashOf(operations);
    const existing = await this.versions.findByHash(project.id, hash, tx);
    if (existing) return { version: existing, created: false };
    const version: SpecVersionRow = { id: uuidv7(), workspaceId: project.workspaceId, projectId: project.id, hash, sourceKind: "project-file", sourceUrl: null, openapiVersion: null, title: null, version: contractVersion, document: null, operationCount: operations.length, createdAt: isoNow() };
    await this.versions.insert(version, operations, tx);
    return { version, created: true };
  }
}
