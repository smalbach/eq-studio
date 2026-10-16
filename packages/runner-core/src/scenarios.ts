/**
 * The test matrix: from one endpoint and its project's configuration, every case worth running.
 *
 * A 200 is not a test that passes. Besides the happy path each operation gets the cases the
 * contract declares and nobody tends to exercise: the 404 of a write, the 409 of a natural key,
 * the 422 of an empty PUT, and the 401/403 of every protected operation.
 */
import { localized, tr } from "./i18n.mjs";
import { existingId, fromTemplate, missingId, operationKind, pathParameters } from "./project.ts";
import type { Endpoint, Locale, ProjectConfig, TestScenario } from "./types.ts";

function queryParametersOf(endpoint: Endpoint) {
  return endpoint.parameters?.filter((name) => !endpoint.path.includes(`{${name}}`)) ?? [];
}

function geoScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const geo = config.plugins?.geo;
  if (!geo || !queryParametersOf(endpoint).includes(geo.lat)) return [];
  const invalid = geo.invalidStatus ?? 422;
  const text = (id: string, field: "name" | "description", es: string, en: string) => {
    const override = geo.texts?.[id]?.[field];
    return override ? localized(locale, override) : tr(locale, es, en);
  };
  const describe = (id: string, es: string, en: string) => text(id, "description", es, en);
  const center = { [geo.lat]: geo.center.lat, [geo.lon]: geo.center.lon };
  const [smallest] = geo.radiiKm;
  const scenarios: TestScenario[] = geo.radiiKm.map((radius, index) => ({
    id: `geo-${radius}km`,
    name: tr(locale, `Radio geográfico · ${radius} km`, `Geographic radius · ${radius} km`),
    description: index === 0
      ? describe(`geo-${radius}km`, "Combina latitud, longitud y radio.", "Combines latitude, longitude and radius.")
      : describe(`geo-${radius}km`, `Un radio amplio debe alcanzar más resultados que el de ${smallest} km.`, `A wide radius must reach more results than the ${smallest} km one.`),
    expectedStatus: 200,
    parameters: { ...center, [geo.radius]: radius },
    flow: "request",
  }));
  scenarios.push({ id: "geo-default", name: tr(locale, "Radio geográfico por defecto", "Default geographic radius"), description: describe("geo-default", "Envía coordenadas y verifica el radio contractual por defecto.", "Sends coordinates and checks the contract's default radius."), expectedStatus: 200, parameters: center, flow: "request" });
  // The case that separates a real geographic filter from no filter at all: around a point with
  // nothing near it the answer is an empty list, and an ignored filter answers with everything.
  if (geo.emptyPoint && smallest) scenarios.push({ id: "geo-empty", name: text("geo-empty", "name", "Radio sin resultados dentro", "Radius with no results inside"), description: describe("geo-empty", "Coordenadas sin datos cerca: 200 con lista vacía, nunca la colección completa.", "Coordinates with no data nearby: 200 with an empty list, never the whole collection."), expectedStatus: 200, parameters: { [geo.lat]: geo.emptyPoint.lat, [geo.lon]: geo.emptyPoint.lon, [geo.radius]: smallest }, flow: "request" });
  scenarios.push({ id: "geo-incomplete", name: tr(locale, "Coordenadas incompletas", "Incomplete coordinates"), description: describe("geo-incomplete", "Latitud sin longitud debe rechazarse.", "Latitude without longitude must be rejected."), expectedStatus: invalid, parameters: { [geo.lat]: geo.center.lat }, flow: "request" });
  if (geo.loneRadiusKm) scenarios.push({ id: "geo-radius-alone", name: tr(locale, `${geo.radius} sin coordenadas`, `${geo.radius} without coordinates`), description: describe("geo-radius-alone", "Un radio sin lat/lon no es media búsqueda: debe rechazarse.", "A radius without lat/lon is not half a search: it must be rejected."), expectedStatus: invalid, parameters: { [geo.radius]: geo.loneRadiusKm }, flow: "request" });
  return scenarios;
}

function listScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const scenarios: TestScenario[] = [{ id: "default", name: tr(locale, "Listado sin filtros", "Unfiltered list"), description: tr(locale, "Valida la respuesta por defecto, envelope y paginación.", "Checks the default response, envelope and pagination."), expectedStatus: 200, flow: "request" }];
  const queryParameters = queryParametersOf(endpoint);
  const geo = config.plugins?.geo;
  const geoParameters = geo ? [geo.lat, geo.lon, geo.radius] : [];
  for (const parameter of queryParameters) {
    if (geoParameters.includes(parameter)) continue;
    for (const sample of config.parameterSamples?.[parameter] ?? [{ value: config.defaultSample ?? "test" }]) {
      const expectedStatus = sample.expectedStatus ?? 200;
      const description = sample.description ? localized(locale, sample.description) : tr(locale, `Ejercita el filtro ${parameter} de forma independiente.`, `Exercises the ${parameter} filter on its own.`);
      scenarios.push({ id: `${parameter}-${sample.value}`, name: `${parameter} = ${sample.value}`, description, expectedStatus, parameters: { [parameter]: sample.value }, flow: "request" });
    }
  }
  const pagination = config.plugins?.pagination;
  if (pagination && queryParameters.includes(pagination.cursorParam)) scenarios.push({ id: "cursor-invalid", name: tr(locale, "Cursor inválido", "Invalid cursor"), description: tr(locale, "Un cursor corrupto debe producir Problem Details y nunca un 500.", "A corrupt cursor must produce Problem Details, never a 500."), expectedStatus: pagination.expectedStatus ?? 422, parameters: { [pagination.cursorParam]: pagination.invalidValue }, flow: "request" });
  scenarios.push(...geoScenarios(endpoint, config, locale));
  return scenarios;
}

function detailScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const names = pathParameters(endpoint.path).filter((name) => endpoint.parameters?.includes(name));
  const required = Object.fromEntries(names.map((name) => [name, existingId(config)]));
  const missing = Object.fromEntries(names.map((name) => [name, missingId(config)]));
  return [
    { id: "found", name: tr(locale, "Recurso existente", "Existing resource"), description: tr(locale, "Consulta un identificador existente y valida la respuesta completa. Si el entorno no tiene filas, crea una temporal y la borra al final.", "Reads an existing id and checks the full response. If the environment has no rows, creates a temporary one and deletes it at the end."), expectedStatus: 200, parameters: required, flow: "existing" },
    { id: "not-found", name: tr(locale, "Recurso inexistente", "Missing resource"), description: tr(locale, "Comprueba el 404 y el formato Problem Details.", "Checks the 404 and the Problem Details format."), expectedStatus: 404, parameters: missing, flow: "request" },
  ];
}

function functionalScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const replaced = config.operationScenarios?.[endpoint.id];
  if (replaced) return replaced.map((template) => fromTemplate(template, locale));
  const kind = operationKind(endpoint, config);
  const base = endpoint.body ?? {};
  const created = endpoint.statuses.includes(201) ? 201 : 200;
  switch (kind) {
    case "list": return listScenarios(endpoint, config, locale);
    case "detail": return detailScenarios(endpoint, config, locale);
    case "bulk":
    case "create": return [
      kind === "bulk"
        ? { id: "create-read", name: tr(locale, "Upsert, consultar y limpiar", "Upsert, read and clean up"), description: tr(locale, "Busca cada registro por su clave natural, ejecuta el bulk, comprueba que cada uno existe y borra solo los que no existían antes.", "Looks up each record by its natural key, runs the bulk, checks each one exists and deletes only those that did not exist before."), expectedStatus: 200, body: base, flow: "bulk-read" }
        : { id: "create-read", name: tr(locale, "Crear y consultar", "Create and read"), description: tr(locale, "Crea el recurso, captura el ID devuelto y lo consulta para comparar todos los campos enviados.", "Creates the resource, captures the returned ID and reads it back to compare every field sent."), expectedStatus: created, body: base, flow: "create-read" },
      { id: "invalid-body", name: tr(locale, "Payload inválido", "Invalid payload"), description: tr(locale, "Envía un body vacío y espera validación 422.", "Sends an empty body and expects a 422 validation error."), expectedStatus: 422, body: {}, flow: "request" },
    ];
    case "replace": return [{ id: "replace-read", name: tr(locale, "Crear, reemplazar y consultar", "Create, replace and read"), description: tr(locale, "Crea una entidad aislada, ejecuta PUT y verifica el estado persistido con GET.", "Creates an isolated entity, runs PUT and checks the persisted state with GET."), expectedStatus: 200, body: endpoint.replaceBody ?? base, flow: "replace-read" }];
    case "patch": return [{ id: "patch-read", name: tr(locale, "Crear, actualizar y consultar", "Create, update and read"), description: tr(locale, "Crea una entidad aislada, ejecuta PATCH y comprueba los campos modificados con GET.", "Creates an isolated entity, runs PATCH and checks the modified fields with GET."), expectedStatus: 200, body: base, flow: "patch-read" }];
    case "delete": return [
      { id: "delete-read", name: tr(locale, "Crear, eliminar y confirmar", "Create, delete and confirm"), description: tr(locale, "Crea una entidad aislada, la elimina y confirma que GET responde 404.", "Creates an isolated entity, deletes it and confirms GET answers 404."), expectedStatus: 204, flow: "delete-read" },
      // What the resource *is* after the DELETE, which is not the same question as whether the
      // DELETE answered 204. A soft delete that hides nothing, a cache that keeps serving the row
      // and a second DELETE that answers 204 over a row that no longer exists all pass the case
      // above and fail this one.
      { id: "deleted-read", name: tr(locale, "Consultar el recurso eliminado", "Read the deleted resource"), description: tr(locale, "Tras eliminarlo, el GET debe responder 404 en Problem Details y un segundo DELETE también 404: ni sigue accesible ni se puede borrar dos veces.", "After deleting it, GET must answer 404 in Problem Details and a second DELETE 404 too: it is neither still reachable nor deletable twice."), expectedStatus: 404, flow: "deleted-read" },
    ];
  }
}

/** The 404 of a write, the 422 of an empty PUT/PATCH and the 409 of a natural key. */
function writeEdgeScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const scenarios: TestScenario[] = [];
  const names = (endpoint.parameters ?? []).filter((name) => endpoint.path.includes(`{${name}}`));
  const missing = Object.fromEntries(names.map((name) => [name, missingId(config)]));
  if (endpoint.statuses.includes(404) && names.length) {
    scenarios.push({ id: "not-found", name: tr(locale, "Recurso inexistente", "Missing resource"), description: tr(locale, "Sobre un identificador que no existe debe responder 404 y no crear nada.", "Over an id that does not exist it must answer 404 and create nothing."), expectedStatus: 404, parameters: missing, body: endpoint.body, flow: "request" });
  }
  // A PUT without the required fields and a PATCH with nothing writable in it are both 422 —
  // but only over an id the API finds: over a missing one it answers 404 before validating.
  if (endpoint.statuses.includes(422) && ["PUT", "PATCH"].includes(endpoint.method)) {
    scenarios.push({ id: "invalid-body", name: tr(locale, "Payload inválido", "Invalid payload"), description: endpoint.method === "PUT" ? tr(locale, "Un PUT sin los campos requeridos debe rechazarse con 422.", "A PUT without the required fields must be rejected with 422.") : tr(locale, "Un PATCH sin ningún campo escribible debe rechazarse con 422.", "A PATCH with no writable field must be rejected with 422."), expectedStatus: 422, parameters: Object.fromEntries(names.map((name) => [name, existingId(config)])), body: {}, flow: "existing" });
  }
  // Self-contained: create, send the same key again, delete. Colliding with a key some fixture
  // happens to hold only works where that fixture exists.
  if (endpoint.statuses.includes(409) && endpoint.method === "POST" && endpoint.body) {
    scenarios.push({ id: "conflict", name: tr(locale, "Clave natural duplicada", "Duplicate natural key"), description: tr(locale, "Crea el recurso, repite la misma clave natural y espera 409 en Problem Details (no una violación de constraint); al final borra lo creado.", "Creates the resource, repeats the same natural key and expects 409 in Problem Details (not a constraint violation); deletes what it created at the end."), expectedStatus: 409, body: endpoint.body, flow: "conflict" });
  }
  return scenarios;
}

/**
 * The 401 and 403 every protected operation declares. They only make sense against an API that
 * enforces authentication, so `runnableScenarios` leaves them out unless auth is on.
 */
function authScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const auth = config.auth ?? {};
  if (auth.publicOperations?.includes(endpoint.id)) return [];
  const scenarios: TestScenario[] = [];
  if (endpoint.statuses.includes(401)) scenarios.push({ id: "auth-none", name: tr(locale, "Sin credencial", "No credential"), description: tr(locale, "Sin token ni API key la operación debe responder 401 en Problem Details.", "With no token or API key the operation must answer 401 in Problem Details."), expectedStatus: 401, flow: "request", auth: "none", body: endpoint.body });
  if (endpoint.statuses.includes(403)) {
    const scope = auth.insufficientScope?.[endpoint.method] ?? auth.insufficientScope?.default;
    const description = scope
      ? tr(locale, `Un token de ${scope} no alcanza para esta operación.`, `A ${scope} token is not enough for this operation.`)
      : tr(locale, "Un token con permisos insuficientes no alcanza para esta operación.", "A token with insufficient permissions is not enough for this operation.");
    scenarios.push({ id: "auth-insufficient", name: tr(locale, "Scope insuficiente", "Insufficient scope"), description, expectedStatus: 403, flow: "request", auth: "insufficient", body: endpoint.body });
  }
  // A credential the operation does not accept is a 401, not a 403: it is not a permission
  // problem, the operation does not take that kind of credential at all.
  if (auth.alternate?.methods.includes(endpoint.method)) scenarios.push({ id: "auth-api-key", name: localized(locale, auth.alternate.name), description: localized(locale, auth.alternate.description), expectedStatus: auth.alternate.expectedStatus, flow: "request", auth: "api-key" });
  return scenarios;
}

export function scenariosFor(endpoint: Endpoint, config: ProjectConfig, locale: Locale = "es"): TestScenario[] {
  const extra = (config.extraScenarios?.[endpoint.id] ?? []).map((template) => fromTemplate(template, locale));
  // Deduplicated by id: a detail GET already generates its own `not-found`, and two cases with
  // the same id would overwrite each other's result.
  const all = [...functionalScenarios(endpoint, config, locale), ...extra, ...writeEdgeScenarios(endpoint, config, locale), ...authScenarios(endpoint, config, locale)];
  return all.filter((scenario, index) => all.findIndex((other) => other.id === scenario.id) === index);
}

/** The subset that can run against the API as it is started: the authorization cases need an
 * API that enforces authentication, and against one that does not they fail for the wrong reason. */
export function runnableScenarios(endpoint: Endpoint, config: ProjectConfig, authEnabled: boolean, locale: Locale = "es"): TestScenario[] {
  return scenariosFor(endpoint, config, locale).filter((scenario) => authEnabled || !scenario.auth || scenario.auth === "default");
}
