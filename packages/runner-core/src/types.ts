/**
 * The shape of a project: everything the core needs to know about one API to generate its test
 * matrix, order it, budget it and run its chained flows.
 *
 * It is plain data on purpose — no functions — so the same object can be written as JSON,
 * stored, synced between machines and imported from an example. Every field beyond `operations`
 * is optional and has a generic default; a project configured with nothing but its contract
 * already gets the list/detail/write/auth matrix.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Locale = "es" | "en";
/** A text given once for both languages, or once per language. */
export type LocalizedText = string | { es: string; en: string };

/** One operation of the contract, flattened: what an OpenAPI import produces. */
export type ContractOperation = {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  tag: string;
  statuses: number[];
  parameters: string[];
};

/** An operation the API routes but the contract does not declare. Never counted as coverage. */
export type ProjectOperation = ContractOperation & { internal?: boolean };

export type Endpoint = ContractOperation & {
  implemented: boolean;
  internal: boolean;
  responseShape: string;
  body?: Record<string, unknown>;
  /** The body a PUT sends in its replace-and-read flow; falls back to `body`. */
  replaceBody?: Record<string, unknown>;
};

export type ScenarioFlow = "request" | "create-read" | "replace-read" | "patch-read" | "delete-read" | "deleted-read" | "bulk-read" | "conflict" | "existing";

/** How a case authenticates: the primary credential, none, one with too little scope, or the
 * alternate credential (an API key, typically). */
export type ScenarioAuth = "default" | "none" | "insufficient" | "api-key";

export type TestScenario = {
  id: string;
  name: string;
  description: string;
  expectedStatus: number;
  parameters?: Record<string, string>;
  body?: Record<string, unknown>;
  flow: ScenarioFlow;
  auth?: ScenarioAuth;
};

/** A scenario as a project writes it: the same, with texts that can carry both languages. */
export type ScenarioTemplate = Omit<TestScenario, "name" | "description"> & { name: LocalizedText; description: LocalizedText };

/** How the generator treats an operation. Derived from method and path unless overridden. */
export type OperationKind = "list" | "detail" | "create" | "bulk" | "replace" | "patch" | "delete";

/** One value to try for a query parameter, and what the API must answer to it. */
export type ParameterSample = { value: string; expectedStatus?: number; description?: LocalizedText };

/**
 * A latency budget rule. Rules are tried in order and the first that matches wins; a matching
 * rule with `ms: null` means "no budget here", and no match at all means the same. **A budget
 * that does not exist is not a budget that passes**: without one, no assertion is emitted.
 *
 * `path` is a glob over the templated path (`*` = one segment, `**` = any depth); `query` is a
 * regular expression tried against the resolved path with its query string.
 */
export type BudgetRule = { methods?: HttpMethod[]; path?: string; query?: string; ms: number | null; label?: LocalizedText; source?: string };
export type Budget = { ms: number; label: string; source: string };

/** How a bulk's records are found again after it runs: they come back as counters, not ids. */
export type BulkLookup = { list: string; keys: string[]; id: string; item: string };

/** Where the ids of one path parameter come from in an environment that is not the seed. */
export type IdSource = { name: string; path: string; operationPath: string; needs?: string };

export type GeoPlugin = {
  lat: string;
  lon: string;
  radius: string;
  /** A point with data around it. */
  center: { lat: string; lon: string };
  /** The radii to try around the center, smallest first. */
  radiiKm: string[];
  /** A point with nothing within the smallest radius: separates a real filter from no filter. */
  emptyPoint?: { lat: string; lon: string };
  /** A radius sent without coordinates, which must be rejected. */
  loneRadiusKm?: string;
  invalidStatus?: number;
  /** Overrides of the generated names and descriptions, by scenario id (`geo-1km`, `geo-empty`, …). */
  texts?: Record<string, { name?: LocalizedText; description?: LocalizedText }>;
};

export type ProjectConfig = {
  name: string;
  contractVersion?: string;
  operations: ProjectOperation[];
  /** The operationIds the API routes today. Absent = every operation. The rest are reported
   * as pending instead of failing. */
  implemented?: string[];
  bodies?: Record<string, { body?: Record<string, unknown>; replaceBody?: Record<string, unknown> }>;
  responseShapes?: Record<string, string>;
  operationKinds?: Record<string, OperationKind>;
  /** Values to try for each query parameter. A parameter with none gets `defaultSample`. */
  parameterSamples?: Record<string, ParameterSample[]>;
  defaultSample?: string;
  /** The id that exists in the seed, and one that never will. */
  ids?: { existing?: string; missing?: string };
  /** Scenarios that replace the generated functional ones of an operation (health checks…). */
  operationScenarios?: Record<string, ScenarioTemplate[]>;
  /** Scenarios appended after the generated functional ones of an operation. */
  extraScenarios?: Record<string, ScenarioTemplate[]>;
  plugins?: {
    geo?: GeoPlugin;
    pagination?: { cursorParam: string; invalidValue: string; expectedStatus?: number };
  };
  auth?: {
    /** Operations that take no credential: no 401/403 cases. */
    publicOperations?: string[];
    /** The scope an insufficient credential carries, by method, for the case description. */
    insufficientScope?: Partial<Record<HttpMethod | "default", string>>;
    /** How the API takes credentials: the header of an API key, and the scheme of the primary
     * credential. The values themselves never live in the project. */
    apiKeyHeader?: string;
    /** A case sending the alternate credential where the operation does not accept it. */
    alternate?: { methods: HttpMethod[]; expectedStatus: number; name: LocalizedText; description: LocalizedText };
  };
  budgets?: BudgetRule[];
  envelope?: {
    /** The member that wraps the payload of a success response (`data`). Empty = no envelope. */
    dataKey?: string;
    /** The member a nested resource answers its key with when it is not the path's name. */
    idFallbackKey?: string;
  };
  bulk?: { recordsKey?: string; lookups?: Record<string, BulkLookup> };
  seed?: {
    /** Where to read existing ids from, in dependency order. */
    sources?: IdSource[];
    /** How many rows per collection to map the seed's ids 1..n onto. */
    mappedRows?: number;
    /** Body fields that hold seed ids and are remapped outside the seed. */
    bodyIdFields?: string[];
  };
};

/** Where a project runs: a base URL and what may be done there. Holds no secret. */
export type EnvironmentConfig = {
  id: string;
  name: string;
  baseUrl: string;
  /** The OpenAPI document: a path under the base URL or an absolute URL. Default `/openapi.json`. */
  specUrl?: string;
  /** Whether the seed's ids are the environment's own (a local or disposable database). When
   * false, existing ids are discovered before a run and writes are opt-in. */
  seeded?: boolean;
  /** Whether POST/PUT/PATCH/DELETE may run here. Off by default outside a seeded environment. */
  writesAllowed?: boolean;
  /** Whether latency budgets decide cases. Off for an environment reached across a network. */
  enforceLatency?: boolean;
  /** Whether the API enforces authentication, so the 401/403 cases make sense. */
  authEnabled?: boolean;
  description?: LocalizedText;
};

/** A project as a file: what `examples/` holds, what export and import move around. */
export type ProjectFile = {
  format: "endpoint-quality/project";
  version: 1;
  project: ProjectConfig;
  environments: EnvironmentConfig[];
  /** Load-test targets beyond the project's GET operations, and the data to fill them. */
  load?: LoadConfig;
};

export type LoadTarget = { id: string; label: string; method?: "GET"; path: string; tag?: string };
export type LoadMix = { id: string; label: LocalizedText; hint?: LocalizedText; targets: { target: string; weight: number }[] };
export type LoadConfig = {
  /** Extra variants of a GET (a filter, a search) that hit a different query plan. */
  targets?: LoadTarget[];
  mixes?: LoadMix[];
  /** Values for each `{placeholder}` of a load target, sampled Zipf-style. */
  data?: Record<string, string[]>;
};
