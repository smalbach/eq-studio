/** Injection tokens. The code runs without `emitDecoratorMetadata` (it is transpiled by esbuild),
 * so every dependency is injected by an explicit token, never by its type. */
export const DATA_SOURCE = Symbol("DATA_SOURCE");
export const APP_CONFIG = Symbol("APP_CONFIG");
export const PROJECTS = Symbol("ProjectRepository");
export const SPEC_VERSIONS = Symbol("SpecVersionRepository");
export const ENVIRONMENTS = Symbol("EnvironmentRepository");
export const SPEC_FETCHER = Symbol("SpecFetcher");
export const CLOCK = Symbol("Clock");
export const SECRET_BOX = Symbol("SecretBox");
export const RUN_QUEUE = Symbol("RunQueue");
export const HTTP_FETCH = Symbol("HttpFetch");
