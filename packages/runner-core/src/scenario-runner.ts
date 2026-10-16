/**
 * How a case runs: one request, or a chained flow — create and read back, create and mutate,
 * create and delete, create and collide — that always deletes what it created.
 *
 * It takes the request function and a callback for "show this response" as arguments, so a UI
 * injects its own transport and state, and a script or the server injects a plain `fetch`.
 * The envelope member, the id fallback and the bulk lookups come from the project.
 */
import { tr } from "./i18n.mjs";
import { dataKey as dataKeyOf, existingId } from "./project.ts";
import type { Endpoint, Locale, ProjectConfig, TestScenario } from "./types.ts";

export type StepResult = {
  ok: boolean;
  durationMs: number;
  step?: string;
  request: { method: string; url: string; body: unknown };
  actual: null | { status: number; body: unknown };
  assertions: { label: string; pass: boolean; detail: string; informative?: boolean }[];
};

export type Execute<R extends StepResult> = (item: Endpoint, scenario: TestScenario, parameterOverrides?: Record<string, string>, options?: { body?: Record<string, unknown>; useEditorBody?: boolean }) => Promise<R>;

/**
 * `hasRows(name)` says whether the environment has rows for an id parameter — the dashboard
 * answers it from the id discovery. Unknown is `true`: a case only writes to set itself up when
 * it is known that there is nothing to read. `locale` is the language of the step names and
 * assertion labels the flows add; saved runs keep whichever language they were run in.
 */
export function createScenarioRunner<R extends StepResult>(endpoints: Endpoint[], config: ProjectConfig, execute: Execute<R>, show: (endpointId: string, result: R) => void = () => {}, hasRows: (name: string) => boolean = () => true, locale: Locale = "es") {
  const t = <V,>(es: V, en: V) => tr(locale, es, en);
  const dataKey = dataKeyOf(config);
  const idFallbackKey = config.envelope?.idFallbackKey ?? "id";
  const recordsKey = config.bulk?.recordsKey ?? "records";
  const bulkLookups = config.bulk?.lookups ?? {};
  /** The payload of a response: its envelope's data member, or the whole body without one. */
  function payloadOf(result: R) {
    const body = result.actual?.body as Record<string, unknown> | undefined;
    return dataKey ? body?.[dataKey] : body;
  }
  function detailEndpointFor(collection: Endpoint) {
    const prefixPlaceholders = (collection.path.match(/\{/g) ?? []).length;
    return endpoints.find((candidate) => candidate.method === "GET" && candidate.path.startsWith(`${collection.path}/{`) && (candidate.path.match(/\{/g) ?? []).length === prefixPlaceholders + 1);
  }
  function idFrom(result: R, detail: Endpoint) {
    const data = payloadOf(result) as Record<string, unknown> | undefined;
    const idField = [...detail.path.matchAll(/\{([^}]+)\}/g)].at(-1)?.[1];
    // Nested resources often answer their key under a generic member (`id`) and not under the
    // path's name. Reading only the path name never finds it, so those flows would never clean
    // up and every later run of them would be a 409.
    return idField && data ? { field: idField, value: String(data[idField] ?? data[idFallbackKey] ?? "") } : undefined;
  }
  /** Compared with the body the write **actually sent** (`request.body`), not with the fixture:
   * outside the seed the ids in it were remapped to the environment's rows. */
  function verifySentFields(result: R, sent: unknown) {
    const fields = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;
    const received = payloadOf(result) as Record<string, unknown> | undefined;
    const mismatches = Object.entries(fields).filter(([key, value]) => JSON.stringify(received?.[key]) !== JSON.stringify(value)).map(([key]) => key);
    const pass = Boolean(received) && mismatches.length === 0;
    result.assertions.push({ label: t("Persistencia de campos", "Field persistence"), pass, detail: pass ? t(`${Object.keys(fields).length} campos coinciden con lo enviado`, `${Object.keys(fields).length} fields match what was sent`) : t(`No coinciden: ${mismatches.join(", ")}`, `Mismatched: ${mismatches.join(", ")}`) });
    result.ok = result.ok && pass;
    return result;
  }
  /**
   * Deletes what a `create-read` case created, so the matrix can be run twice.
   *
   * Without this the second run of a POST over a resource with a natural key is a **409**: the
   * first run already took the key. The conflict is correct behaviour and a useless test case —
   * it reports the state the previous run left behind, not whether the endpoint works.
   *
   * It is pushed as a visible step rather than done quietly: a flow that writes to the database
   * should show everything it wrote and everything it undid.
   */
  async function deleteCreated(detail: Endpoint, captured: { field: string; value: string }) {
    const remove = endpoints.find((candidate) => candidate.method === "DELETE" && candidate.path === detail.path);
    if (!remove) return undefined;
    const parameters = { [captured.field]: captured.value };
    const scenario: TestScenario = { id: "cleanup-delete", name: t("Limpiar el recurso creado", "Clean up the created resource"), description: t("Deja la base como estaba para que el caso pueda repetirse.", "Leaves the database as it was so the case can be repeated."), expectedStatus: 204, parameters, flow: "request" };
    return execute(remove, scenario, parameters);
  }
  function rowsOf(result: R) {
    const data = payloadOf(result);
    return Array.isArray(data) ? data as Record<string, unknown>[] : [];
  }
  /** The record's natural key as the list endpoint's query parameters. */
  function keyOf(record: Record<string, unknown>, keys: string[]) {
    return Object.fromEntries(keys.map((key) => [key, String(record[key] ?? "")]));
  }
  async function lookup(list: Endpoint, parameters: Record<string, string>, step: string) {
    const scenario: TestScenario = { id: "bulk-lookup", name: t("Buscar por clave natural", "Look up by natural key"), description: step, expectedStatus: 200, parameters, flow: "request" };
    const result = await execute(list, scenario);
    result.step = step;
    return result;
  }
  /**
   * A bulk returns counters, not ids — `{created, updated, unchanged, errors}` — so what it
   * wrote is found again by its natural key. Every record is looked up **before** the call;
   * after it, only the ones that did not exist then are deleted. A record that already existed
   * was updated or left `unchanged` over a row that is not the test's to remove, and on a shared
   * environment that row is somebody's data.
   *
   * The lookups go through `execute` with the fixture's own values as parameters, so outside
   * the seed they get the same id remap as the body the bulk sends.
   */
  async function runBulk(item: Endpoint, scenario: TestScenario, steps: R[], useEditorBody: boolean) {
    const spec = bulkLookups[item.path];
    const list = endpoints.find((candidate) => candidate.method === "GET" && candidate.path === spec.list);
    const remove = endpoints.find((candidate) => candidate.method === "DELETE" && candidate.path === spec.item);
    const records = (((scenario.body ?? {}) as Record<string, Record<string, unknown>[] | undefined>)[recordsKey] ?? []);
    if (!list || !remove || useEditorBody || !records.length) {
      steps.push(await execute(item, scenario, {}, { useEditorBody }));
      return;
    }
    const existedBefore: boolean[] = [];
    for (const record of records) {
      const before = await lookup(list, keyOf(record, spec.keys), t("Preparación: ¿ya existía este registro? Si existía, no se borra al final", "Setup: did this record already exist? If it did, it is not deleted at the end"));
      steps.push(before);
      // A lookup that could not answer counts as "existed": never delete what could not be
      // proven to be the test's own.
      existedBefore.push(!before.ok || rowsOf(before).length > 0);
    }
    const bulk = await execute(item, scenario);
    bulk.step = t("El caso: el bulk upsert", "The case: the bulk upsert");
    steps.push(bulk);
    show(item.id, bulk);
    for (const [index, record] of records.entries()) {
      const after = await lookup(list, keyOf(record, spec.keys), t("Verificación: el registro existe tras el bulk", "Verification: the record exists after the bulk"));
      const row = rowsOf(after)[0];
      const found = after.ok && Boolean(row);
      after.assertions.push({ label: t("Registro persistido", "Record persisted"), pass: found, detail: found ? `${spec.id} = ${row?.[spec.id]}` : t("Ninguna fila para ", "No row for ") + Object.entries(keyOf(record, spec.keys)).map(([key, value]) => `${key}=${value}`).join(", ") });
      after.ok = after.ok && found;
      steps.push(after);
      if (found && !existedBefore[index]) {
        const id = String(row?.[spec.id]);
        const cleanup: TestScenario = { id: "cleanup-delete", name: t("Limpiar el registro creado por el bulk", "Clean up the record the bulk created"), description: t("Lo creó esta corrida: se borra para que el entorno quede como estaba.", "This run created it: it is deleted so the environment is left as it was."), expectedStatus: 204, flow: "request" };
        const removed = await execute(remove, cleanup, { [spec.id]: id });
        removed.step = t("Limpieza: lo creó este bulk, se borra", "Cleanup: this bulk created it, it is deleted");
        steps.push(removed);
      }
    }
  }
  /**
   * A case that needs a row that exists. Over the seed's id when the environment has rows; when
   * it has none, over a temporary row created through the collection's POST and deleted at the
   * end — the case is the same, only where its row comes from changes. `isolated` takes the
   * temporary row even when the environment has rows: for a case that may change the one it hits.
   */
  async function runOverExisting(item: Endpoint, scenario: TestScenario, steps: R[], initialParameters: Record<string, string>, useEditorBody: boolean, isolated = false) {
    const idField = [...item.path.matchAll(/\{([^}]+)\}/g)].at(-1)?.[1];
    const collectionPath = item.path.replace(/\/\{[^}]+\}$/, "");
    const createEndpoint = endpoints.find((candidate) => candidate.method === "POST" && candidate.path === collectionPath);
    const readEndpoint = endpoints.find((candidate) => candidate.method === "GET" && candidate.path === item.path);
    // An id changed in the editor is the user's choice, and is used as it is. The editor starts
    // with the case's own parameters, so an unchanged one is still the case's seed id.
    const typed = initialParameters[idField ?? ""];
    const chosen = Boolean(typed) && typed !== scenario.parameters?.[idField ?? ""];
    if (!idField || (!isolated && hasRows(idField)) || chosen || !createEndpoint || !readEndpoint) {
      steps.push(await execute(item, scenario, initialParameters, { useEditorBody }));
      return;
    }
    const createScenario: TestScenario = { id: "setup-create", name: t("Preparar entidad", "Prepare entity"), description: isolated ? t("Una fila propia del caso", "A row of the case's own") : t("El entorno no tiene filas de este recurso", "The environment has no rows of this resource"), expectedStatus: createEndpoint.statuses.includes(201) ? 201 : 200, body: createEndpoint.body, flow: "request" };
    const created = await execute(createEndpoint, createScenario);
    created.step = isolated
      ? t("Preparación: crea una fila temporal, para que una entrada inválida aceptada no cambie una existente", "Setup: creates a temporary row, so invalid input that is accepted changes no existing one")
      : t("Preparación: el entorno no tiene filas de este recurso, crea una temporal", "Setup: the environment has no rows of this resource, creates a temporary one");
    steps.push(created);
    const captured = idFrom(created, readEndpoint);
    const capturedOk = Boolean(captured?.value);
    created.assertions.push({ label: t("ID de preparación", "Setup ID"), pass: capturedOk, detail: capturedOk ? `${captured?.field} = ${captured?.value}` : t("No se pudo capturar el identificador", "The id could not be captured") });
    created.ok = created.ok && capturedOk;
    if (!captured?.value) return;
    if (created.ok) {
      const result = await execute(item, scenario, { ...initialParameters, [idField]: captured.value }, { useEditorBody });
      result.step = t("El caso, sobre la fila temporal", "The case, over the temporary row");
      steps.push(result);
      show(item.id, result);
    }
    const cleanup = await deleteCreated(readEndpoint, captured);
    if (cleanup) { cleanup.step = t("Limpieza: borra la fila temporal", "Cleanup: deletes the temporary row"); steps.push(cleanup); }
  }
  /**
   * A negative case: one request with bad input that must come back 4xx. A PUT or PATCH sends
   * it over a temporary row, so an API that wrongly accepts it changes a row of the case's own
   * and not one the rest of the matrix reads. A POST that wrongly accepts it has created
   * something, and that is deleted.
   */
  async function runNegative(item: Endpoint, scenario: TestScenario, steps: R[], initialParameters: Record<string, string>, useEditorBody: boolean) {
    const idField = [...item.path.matchAll(/\{([^}]+)\}/g)].at(-1)?.[1];
    // A fault in the id itself is sent as it is: there is no row to isolate.
    const overExisting = Boolean(idField) && (scenario.parameters?.[idField ?? ""] ?? existingId(config)) === existingId(config);
    if (["PUT", "PATCH"].includes(item.method) && overExisting) {
      await runOverExisting(item, scenario, steps, initialParameters, useEditorBody, true);
      return;
    }
    const result = await execute(item, scenario, initialParameters, { useEditorBody });
    steps.push(result);
    const status = result.actual?.status ?? 0;
    const detail = item.method === "POST" && status >= 200 && status < 300 ? detailEndpointFor(item) : undefined;
    const captured = detail ? idFrom(result, detail) : undefined;
    if (detail && captured?.value) {
      const cleanup = await deleteCreated(detail, captured);
      if (cleanup) { cleanup.step = t("Limpieza: la API aceptó la entrada inválida y creó un recurso; se borra", "Cleanup: the API accepted the invalid input and created a resource; it is deleted"); steps.push(cleanup); }
    }
  }
  async function runScenario(item: Endpoint, scenario: TestScenario, initialParameters: Record<string, string> = {}, useEditorBody = false): Promise<{ ok: boolean; durationMs: number; steps: R[] }> {
    const steps: R[] = [];
    if (scenario.flow === "request") {
      steps.push(await execute(item, scenario, initialParameters, { useEditorBody }));
    } else if (scenario.flow === "existing") {
      await runOverExisting(item, scenario, steps, initialParameters, useEditorBody);
    } else if (scenario.flow === "negative") {
      await runNegative(item, scenario, steps, initialParameters, useEditorBody);
    } else if (scenario.flow === "bulk-read" && bulkLookups[item.path]) {
      await runBulk(item, scenario, steps, useEditorBody);
    } else if (scenario.flow === "bulk-read") {
      steps.push(await execute(item, scenario, initialParameters, { useEditorBody }));
    } else if (scenario.flow === "create-read") {
      const created = await execute(item, scenario, initialParameters, { useEditorBody });
      steps.push(created);
      const detail = detailEndpointFor(item);
      if (detail) {
        const captured = idFrom(created, detail);
        const capturedOk = Boolean(captured?.value);
        created.assertions.push({ label: t("ID retornado", "Returned ID"), pass: capturedOk, detail: capturedOk ? `${captured?.field} = ${captured?.value}` : t("La respuesta no contiene el identificador esperado", "The response does not contain the expected id") });
        created.ok = created.ok && capturedOk;
        if (captured?.value) {
          if (created.ok) {
            const readScenario: TestScenario = { id: "verify-created", name: t("Consultar ID creado", "Read the created ID"), description: t("Verificación posterior", "Follow-up verification"), expectedStatus: 200, parameters: { [captured.field]: captured.value }, flow: "request" };
            const verified = verifySentFields(await execute(detail, readScenario, readScenario.parameters), created.request.body);
            steps.push(verified);
            show(item.id, verified);
          }
          // Whenever something was created, it is deleted — also when the case already failed.
          // A red case that leaves its row behind turns the next run's POST into a 409.
          const cleanup = await deleteCreated(detail, captured);
          if (cleanup) steps.push(cleanup);
        }
      }
    } else if (scenario.flow === "conflict") {
      // Self-contained: the key that collides is the one this flow just created, not one some
      // fixture happens to hold. Where that fixture does not exist, the "duplicate" would be a
      // fresh key — answered 201 and left behind.
      const detail = detailEndpointFor(item);
      const first = await execute(item, { ...scenario, id: "setup-create", name: t("Crear la clave", "Create the key"), expectedStatus: item.statuses.includes(201) ? 201 : 200 }, initialParameters);
      first.step = t("Preparación: crea el recurso con una clave nueva", "Setup: creates the resource with a new key");
      steps.push(first);
      const captured = detail ? idFrom(first, detail) : undefined;
      if (first.ok) {
        const duplicate = await execute(item, scenario, initialParameters, { body: first.request.body as Record<string, unknown> });
        duplicate.step = t("El caso: repetir la misma clave debe ser 409 en Problem Details", "The case: repeating the same key must be 409 in Problem Details");
        steps.push(duplicate);
        show(item.id, duplicate);
      }
      if (detail && captured?.value) {
        const cleanup = await deleteCreated(detail, captured);
        if (cleanup) steps.push(cleanup);
      }
    } else {
      const idField = [...item.path.matchAll(/\{([^}]+)\}/g)].at(-1)?.[1];
      const collectionPath = item.path.replace(/\/\{[^}]+\}$/, "");
      const createEndpoint = endpoints.find((candidate) => candidate.method === "POST" && candidate.path === collectionPath);
      const readEndpoint = endpoints.find((candidate) => candidate.method === "GET" && candidate.path === item.path);
      if (!idField || !createEndpoint || !readEndpoint) {
        steps.push(await execute(item, scenario, {}, { useEditorBody }));
      } else {
        const createScenario: TestScenario = { id: "setup-create", name: t("Preparar entidad", "Prepare entity"), description: t("Prerequisito aislado", "Isolated prerequisite"), expectedStatus: createEndpoint.statuses.includes(201) ? 201 : 200, body: createEndpoint.body, flow: "request" };
        const created = await execute(createEndpoint, createScenario);
        steps.push(created);
        const captured = idFrom(created, readEndpoint);
        const capturedOk = Boolean(captured?.value);
        created.assertions.push({ label: t("ID de preparación", "Setup ID"), pass: capturedOk, detail: capturedOk ? `${captured?.field} = ${captured?.value}` : t("No se pudo capturar el identificador", "The id could not be captured") });
        created.ok = created.ok && capturedOk;
        if (captured?.value && scenario.flow === "deleted-read") {
          // Here the DELETE is the setup and the GET is the case: what is asserted is the state
          // the deletion leaves, not the 204 it answered with. The second DELETE closes the
          // other half — a resource that is already gone is a 404, not a 204 over nothing.
          const parameters = { [idField]: captured.value };
          const removal = await execute(item, { ...scenario, id: "setup-delete", name: t("Eliminar el recurso", "Delete the resource"), expectedStatus: 204 }, parameters);
          created.step = t("Preparación: crea la entidad que se va a eliminar", "Setup: creates the entity to be deleted");
          removal.step = t("Preparación: la elimina. El 204 lo comprueba el caso anterior", "Setup: deletes it. The previous case checks the 204");
          steps.push(removal);
          if (removal.ok) {
            const readScenario: TestScenario = { id: "read-deleted", name: t("Consultar el recurso eliminado", "Read the deleted resource"), description: t("El GET posterior al DELETE", "The GET after the DELETE"), expectedStatus: 404, parameters, flow: "request" };
            const read = await execute(readEndpoint, readScenario, parameters);
            read.step = t("El caso: consultar lo eliminado debe ser 404 en Problem Details", "The case: reading what was deleted must be 404 in Problem Details");
            steps.push(read);
            const repeatScenario: TestScenario = { id: "delete-again", name: t("Eliminar de nuevo", "Delete again"), description: t("Un segundo DELETE sobre lo que ya no existe", "A second DELETE over what no longer exists"), expectedStatus: 404, parameters, flow: "request" };
            const repeated = await execute(item, repeatScenario, parameters);
            repeated.step = t("Un segundo DELETE sobre lo que ya no existe: 404, no 204", "A second DELETE over what no longer exists: 404, not 204");
            steps.push(repeated);
            // The panel shows the case under test, which is the GET — not the last request the
            // flow happened to send.
            show(item.id, read);
          } else {
            const cleanup = await deleteCreated(readEndpoint, captured);
            if (cleanup) steps.push(cleanup);
          }
        } else if (captured?.value) {
          const parameters = { [idField]: captured.value };
          const mutation = created.ok ? await execute(item, scenario, parameters, { useEditorBody }) : undefined;
          if (mutation) steps.push(mutation);
          if (mutation?.ok) {
            const verifyScenario: TestScenario = { id: "verify-mutation", name: t("Verificar persistencia", "Verify persistence"), description: t("Consulta posterior", "Follow-up read"), expectedStatus: scenario.flow === "delete-read" ? 404 : 200, parameters, flow: "request" };
            const verification = await execute(readEndpoint, verifyScenario, parameters);
            if (scenario.flow !== "delete-read") verifySentFields(verification, mutation.request.body);
            steps.push(verification);
            show(item.id, verification);
            // `delete-read` already removed the entity — that **is** the case under test. The
            // other two leave behind the prerequisite they created, and over a resource with a
            // UNIQUE that leftover is what makes the next run of the POST a 409: the matrix
            // would only be green the first time it is run.
          }
          // The prerequisite goes whatever happened to the mutation. Only a DELETE that worked
          // has already removed it — that removal **is** the `delete-read` case.
          if (!(scenario.flow === "delete-read" && mutation?.ok)) {
            const cleanup = await deleteCreated(readEndpoint, captured);
            if (cleanup) steps.push(cleanup);
          }
        }
      }
    }
    return { ok: steps.length > 0 && steps.every((step) => step.ok), durationMs: steps.reduce((total, step) => total + step.durationMs, 0), steps };
  }
  return { runScenario };
}
