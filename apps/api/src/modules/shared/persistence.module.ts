import { Global, Module } from "@nestjs/common";
import { ProjectRepository } from "../projects/infrastructure/project.repository.ts";
import { SpecVersionRepository } from "../specs/infrastructure/spec-version.repository.ts";
import { HttpSpecFetcher } from "../specs/infrastructure/spec-fetcher.ts";
import { EnvironmentRepository } from "../environments/infrastructure/environment.repository.ts";
import { SpecImporter } from "../specs/application/spec-importer.ts";
import { ProjectReader } from "../projects/application/project-reader.ts";
import { APP_CONFIG, HTTP_FETCH, SECRET_BOX, SPEC_FETCHER } from "../../shared/tokens.ts";
import { SecretBox } from "../../shared/secret-box.ts";
import { guardedFetch } from "../../shared/guarded-fetch.ts";
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
    { provide: HTTP_FETCH, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.network?.allowPrivateTargets === false ? guardedFetch : (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init) },
  ],
  exports: [ProjectRepository, SpecVersionRepository, EnvironmentRepository, CredentialRepository, AccountsRepository, AuditLog, Mailer, SpecImporter, ProjectReader, SPEC_FETCHER, SECRET_BOX, HTTP_FETCH],
})
export class PersistenceModule {}
