import { Global, Module } from "@nestjs/common";
import { ProjectRepository } from "../projects/infrastructure/project.repository.ts";
import { SpecVersionRepository } from "../specs/infrastructure/spec-version.repository.ts";
import { HttpSpecFetcher } from "../specs/infrastructure/spec-fetcher.ts";
import { EnvironmentRepository } from "../environments/infrastructure/environment.repository.ts";
import { SpecImporter } from "../specs/application/spec-importer.ts";
import { ProjectReader } from "../projects/application/project-reader.ts";
import type { TlsMaterial } from "@eq/runner-core";
import { Agent, fetch as undiciFetch } from "undici";
import { APP_CONFIG, HTTP_FETCH, HTTP_TLS_AGENT, SECRET_BOX, SPEC_FETCHER } from "../../shared/tokens.ts";
import { SecretBox } from "../../shared/secret-box.ts";
import { guardedFetch, guardedTlsAgent } from "../../shared/guarded-fetch.ts";
import type { AppConfig } from "../../config.ts";
import { CredentialRepository } from "../credentials/infrastructure/credential.repository.ts";
import { AccountsRepository } from "../accounts/infrastructure/accounts.repository.ts";
import { AuditLog } from "../audit/audit-log.ts";
import { Mailer } from "../../shared/mailer.ts";

/** The repositories and services every feature module shares. */
@Global()
@Module({
  providers: [
    ProjectRepository, SpecVersionRepository, EnvironmentRepository, CredentialRepository, AccountsRepository, SpecImporter, ProjectReader, AuditLog, Mailer,
    { provide: SPEC_FETCHER, useClass: HttpSpecFetcher },
    { provide: SECRET_BOX, inject: [APP_CONFIG], useFactory: (config: AppConfig) => SecretBox.from(config.secrets) },
    // Every outbound request of a hosted deployment goes through the SSRF guard.
    // A request with a client certificate carries its own dispatcher, an undici `Agent`: it goes
    // through undici's fetch, the one that dispatcher belongs to.
    { provide: HTTP_FETCH, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.network?.allowPrivateTargets === false ? guardedFetch : (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => (init as { dispatcher?: unknown } | undefined)?.dispatcher ? undiciFetch(input as never, init as never) as unknown as Promise<Response> : fetch(input, init) },
    { provide: HTTP_TLS_AGENT, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.network?.allowPrivateTargets === false ? guardedTlsAgent : (tls: Partial<TlsMaterial>) => new Agent({ connect: tls }) },
  ],
  exports: [ProjectRepository, SpecVersionRepository, EnvironmentRepository, CredentialRepository, AccountsRepository, AuditLog, Mailer, SpecImporter, ProjectReader, SPEC_FETCHER, SECRET_BOX, HTTP_FETCH, HTTP_TLS_AGENT],
})
export class PersistenceModule {}
