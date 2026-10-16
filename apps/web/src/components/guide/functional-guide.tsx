import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Flex, IconButton, Select, Spinner, Table, Text, TextArea, TextField } from "@radix-ui/themes";
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { GeoPlugin, ParameterSample, ProjectConfig } from "@eq/runner-core";
import type { Environment } from "@/components/environment/use-environment";
import { choice, errorText, Example, fetchMatrix, Field, GuideFrame, Notice, Toggle } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import { MethodBadge } from "@/components/common/method-badge";
import { API } from "@/lib/api";
import { useProject } from "@/lib/project-store";
import type { Workspace } from "@/lib/use-workspace";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    generateTitle: "Generar desde el contrato", generateIntro: "La importación ya generó una configuración a partir del schema: samples por parámetro, bodies de ejemplo, plugins y de dónde leer ids. Regenerar en modo «merge» rellena lo que falte —por ejemplo, tras importar una versión nueva del contrato— y conserva todo lo ajustado a mano.",
    regenerate: "Regenerar (merge)", regenerated: "Configuración regenerada: lo ajustado a mano se conservó.", cases: "Casos en la matriz", samples: "Parámetros con samples", bodies: "Bodies", plugins: "Plugins",
    samplesTitle: "Samples por parámetro", samplesIntro: "Cada valor es un caso de cada listado que tenga ese parámetro de query, con el status que la API debe responder. Incluye valores inválidos: un límite fuera de rango debe dar 422, no recortarse en silencio.",
    parameter: "Parámetro", value: "Valor", expected: "Status esperado", addValue: "Añadir valor", noParameters: "Ninguna operación tiene parámetros de query: no hay samples que configurar.", usedBy: (n: number) => `En ${n} listados`, invalidSamples: "Cada valor necesita texto y un status entre 100 y 599.",
    bodiesTitle: "Bodies por operación", bodiesIntro: "Lo que envía cada escritura. Usa claves naturales que no existan (ORD-TEST-0001): si no, «crear» recibe 409. El PUT lleva además replaceBody, que debe cambiar algo respecto a lo creado.",
    body: "body", replaceBody: "replaceBody (PUT)", invalidJson: (name: string, message: string) => `${name}: no es un objeto JSON válido (${message}).`, noWrites: "El contrato no tiene escrituras con body.",
    flowsTitle: "Flujos encadenados", flowsIntro: "Las escrituras se prueban como flujos que crean lo que necesitan, comprueban el resultado con un GET y borran lo creado al final, aunque el caso falle. No hay nada que configurar aquí salvo los bodies; esta es la lista de flujos que correrán.",
    flowNames: { "create-read": "crear → leer → borrar", "replace-read": "crear → PUT → leer → borrar", "patch-read": "crear → PATCH → leer → borrar", "delete-read": "crear → DELETE → GET 404", "deleted-read": "crear → DELETE → GET y DELETE 404", "bulk-read": "buscar → bulk → buscar → borrar lo nuevo", conflict: "crear → repetir clave → 409 → borrar", existing: "leer un id existente (o crear uno temporal)" } as Record<string, string>,
    idKey: (key: string) => `El id creado se busca por el nombre del placeholder o, si no, por «${key}» (envelope.idFallbackKey).`,
    pluginsTitle: "Plugins", pluginsIntro: "Generadores de casos opcionales para patrones comunes.",
    pagination: "Paginación por cursor", paginationHint: "Añade a cada listado con el parámetro un caso con un cursor corrupto: debe ser un error en Problem Details, nunca un 500 ni la primera página.",
    cursorParam: "Parámetro del cursor", invalidValue: "Valor corrupto", expectedStatus: "Status esperado",
    geo: "Búsqueda geográfica", geoHint: "Para listados que filtran por latitud, longitud y radio: un caso por radio, un punto vacío (separa un filtro real de ninguno), coordenadas incompletas y un radio sin coordenadas.",
    lat: "Parámetro de latitud", lon: "Parámetro de longitud", radius: "Parámetro de radio", center: "Centro (lat, lon)", radii: "Radios en km, de menor a mayor", emptyPoint: "Punto sin datos cerca (lat, lon)", loneRadius: "Radio sin coordenadas (km)", invalidStatus: "Status de una búsqueda incompleta",
    invalidPlugins: "Completa los campos del plugin activado.",
    matrixTitle: "La matriz resultante", matrixIntro: "Lo que correrá una ejecución completa, operación por operación. Ábrelas para ver cada caso y su status esperado.", withAuth: "Incluir los casos 401/403", total: (n: number) => `${n} casos`, run: "Ir a ejecutar la matriz",
    saveAndNext: "Guardar y seguir", saved: "Guardado.",
  },
  en: {
    generateTitle: "Generate from the contract", generateIntro: "The import already generated a configuration from the schema: samples per parameter, sample bodies, plugins and where to read ids from. Regenerating in \"merge\" mode fills in whatever is missing — after importing a new contract version, say — and keeps everything tuned by hand.",
    regenerate: "Regenerate (merge)", regenerated: "Configuration regenerated: hand-tuned values were kept.", cases: "Cases in the matrix", samples: "Parameters with samples", bodies: "Bodies", plugins: "Plugins",
    samplesTitle: "Samples per parameter", samplesIntro: "Each value is a case of every list that has that query parameter, with the status the API must answer. Include invalid values: an out-of-range limit must give a 422, not be clamped silently.",
    parameter: "Parameter", value: "Value", expected: "Expected status", addValue: "Add value", noParameters: "No operation has query parameters: there are no samples to configure.", usedBy: (n: number) => `In ${n} lists`, invalidSamples: "Every value needs text and a status between 100 and 599.",
    bodiesTitle: "Bodies per operation", bodiesIntro: "What each write sends. Use natural keys that do not exist (ORD-TEST-0001): otherwise \"create\" gets a 409. A PUT also carries replaceBody, which must change something from what was created.",
    body: "body", replaceBody: "replaceBody (PUT)", invalidJson: (name: string, message: string) => `${name}: not a valid JSON object (${message}).`, noWrites: "The contract has no writes with a body.",
    flowsTitle: "Chained flows", flowsIntro: "Writes are tested as flows that create what they need, check the result with a GET and delete what they created at the end, even if the case fails. There is nothing to configure here beyond the bodies; this is the list of flows that will run.",
    flowNames: { "create-read": "create → read → delete", "replace-read": "create → PUT → read → delete", "patch-read": "create → PATCH → read → delete", "delete-read": "create → DELETE → GET 404", "deleted-read": "create → DELETE → GET and DELETE 404", "bulk-read": "look up → bulk → look up → delete the new ones", conflict: "create → repeat key → 409 → delete", existing: "read an existing id (or create a temporary one)" } as Record<string, string>,
    idKey: (key: string) => `The created id is looked up by the placeholder's name or, failing that, by "${key}" (envelope.idFallbackKey).`,
    pluginsTitle: "Plugins", pluginsIntro: "Optional case generators for common patterns.",
    pagination: "Cursor pagination", paginationHint: "Adds to every list with the parameter a case with a corrupt cursor: it must be a Problem Details error, never a 500 nor the first page.",
    cursorParam: "Cursor parameter", invalidValue: "Corrupt value", expectedStatus: "Expected status",
    geo: "Geographic search", geoHint: "For lists filtering by latitude, longitude and radius: one case per radius, an empty point (tells a real filter from none), incomplete coordinates and a radius with no coordinates.",
    lat: "Latitude parameter", lon: "Longitude parameter", radius: "Radius parameter", center: "Center (lat, lon)", radii: "Radii in km, smallest first", emptyPoint: "Point with no data nearby (lat, lon)", loneRadius: "Radius with no coordinates (km)", invalidStatus: "Status of an incomplete search",
    invalidPlugins: "Fill in the fields of the plugin you turned on.",
    matrixTitle: "The resulting matrix", matrixIntro: "What a full run will execute, operation by operation. Open them to see each case and its expected status.", withAuth: "Include the 401/403 cases", total: (n: number) => `${n} cases`, run: "Go run the matrix",
    saveAndNext: "Save and continue", saved: "Saved.",
  },
});

type Bodies = NonNullable<ProjectConfig["bodies"]>;
type Plugins = NonNullable<ProjectConfig["plugins"]>;
const validStatus = (value: number | undefined) => value === undefined || (Number.isInteger(value) && value >= 100 && value <= 599);
// Radix Select has no empty value: an unset parameter is shown under this one.
const NONE = "__none__";

/** A JSON object typed by hand: the object, or why it is not one. */
function parseObject(text: string): { value?: Record<string, unknown>; error?: string } {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? { value: value as Record<string, unknown> } : { error: "{ … }" };
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : String(failure) };
  }
}

/**
 * The functional configuration, section by section: each step edits one section of the project
 * and saves it with the revision it read, so a change made elsewhere in the meantime is a 409
 * instead of being silently overwritten. The API validates each section against the contract.
 */
export function FunctionalGuide({ guide, workspace, env, step, onStep, onDone }: { guide: GuideEntry; workspace: Workspace; env: Environment; step: number; onStep: (step: number) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const client = useQueryClient();
  const project = useProject();
  const projectId = project.id;
  const config = useQuery({ queryKey: ["guide-config", projectId], queryFn: () => API.config(projectId), enabled: Boolean(projectId) });
  const [auth, setAuth] = useState(env.authEnabled);
  const matrix = useQuery({ queryKey: ["guide-matrix", projectId, auth, locale], queryFn: () => fetchMatrix(projectId, auth, locale), enabled: Boolean(projectId) && (step === 0 || step >= 3) });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Unsaved edits per section; `null` means "show what the API holds".
  const [samples, setSamples] = useState<Record<string, ParameterSample[]> | null>(null);
  const [bodyTexts, setBodyTexts] = useState<Record<string, { body: string; replaceBody: string }>>({});
  const [selected, setSelected] = useState("");
  const [plugins, setPlugins] = useState<Plugins | null>(null);
  const [open, setOpen] = useState<string[]>([]);

  const saved = config.data?.config;
  const operations = project.file.project.operations;
  // The geo plugin generates the cases of its own three parameters: they take no samples.
  const activeGeo = (plugins ?? saved?.plugins)?.geo;
  const geoParameters = activeGeo ? [activeGeo.lat, activeGeo.lon, activeGeo.radius] : [];
  const queryParameters = [...new Set(operations.flatMap((operation) => operation.parameters.filter((name) => !operation.path.includes(`{${name}}`))))];
  const frame = { guide, step, onStep, maxStep: 5 };

  /** Saves one section with the revision it was read at, then re-reads everything. */
  async function saveSection(section: string, value: unknown) {
    await API.updateSection(projectId, section, value, config.data?.rev);
    await client.invalidateQueries({ queryKey: ["guide-config", projectId] });
    await client.invalidateQueries({ queryKey: ["guide-matrix", projectId] });
    await workspace.refresh();
  }

  async function regenerate() {
    setBusy(true); setError(""); setNotice("");
    try {
      await API.generateConfig(projectId, "merge");
      await client.invalidateQueries({ queryKey: ["guide-config", projectId] });
      await client.invalidateQueries({ queryKey: ["guide-matrix", projectId] });
      await workspace.refresh();
      setSamples(null); setPlugins(null); setBodyTexts({});
      setNotice(t.regenerated);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (step === 0) {
    const stats: [string | number, string][] = [[matrix.data?.total ?? "…", t.cases], [Object.keys(saved?.parameterSamples ?? {}).length, t.samples], [Object.keys(saved?.bodies ?? {}).length, t.bodies], [Object.keys(saved?.plugins ?? {}).join(", ") || "—", t.plugins]];
    return <GuideFrame {...frame} title={t.generateTitle} intro={t.generateIntro} canNext={Boolean(saved)} doc="funcional"
      example={<Example code={`POST /v1/projects/store-api/config/generate\n{ "mode": "merge" }`}><p>{locale === "en" ? "\"replace\" (API only) discards hand-tuned values and starts again from the contract." : "«replace» (solo por API) descarta lo ajustado a mano y vuelve a empezar desde el contrato."}</p></Example>}>
      <div className="grid gap-3 sm:grid-cols-4">{stats.map(([value, label]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="truncate text-lg font-semibold tabular-nums text-slate-900">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>)}</div>
      <Button type="button" size="2" variant="surface" color="gray" disabled={busy || !projectId} onClick={() => { void regenerate(); }}>{busy ? <Spinner size="1"/> : <RefreshCw className="size-3.5"/>}{t.regenerate}</Button>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {(error || config.error) && <Notice tone="error">{error || errorText(config.error)}</Notice>}
    </GuideFrame>;
  }

  if (step === 1) {
    const current = samples ?? saved?.parameterSamples ?? {};
    const editable = queryParameters.filter((name) => !geoParameters.includes(name));
    const parameter = editable.includes(selected) ? selected : editable[0] ?? "";
    const rows = current[parameter] ?? [];
    const valid = Object.values(current).every((list) => list.every((sample) => sample.value.trim() && validStatus(sample.expectedStatus)));
    const setRows = (next: ParameterSample[]) => setSamples({ ...current, [parameter]: next });
    const users = operations.filter((operation) => operation.parameters.includes(parameter) && !operation.path.includes(`{${parameter}}`)).length;
    return <GuideFrame {...frame} title={t.samplesTitle} intro={t.samplesIntro} canNext={valid} next={samples ? async () => { await saveSection("parameterSamples", samples); setSamples(null); } : undefined} nextLabel={samples ? t.saveAndNext : undefined} doc="formato"
      example={<Example code={`"limit": [\n  { "value": "10" },\n  { "value": "0", "expectedStatus": 422 },\n  { "value": "101", "expectedStatus": 422 }\n],\n"status": [\n  { "value": "shipped" },\n  { "value": "nope", "expectedStatus": 422 }\n]`}/>}>
      {!editable.length ? <Notice>{t.noParameters}</Notice> : <>
        <div className="flex flex-wrap gap-1.5">{editable.map((name) => <button key={name} type="button" onClick={() => setSelected(name)} className={cn(choice(name === parameter), "px-2.5 py-1 font-mono")}>{name} <span className="text-slate-400">{(current[name] ?? []).length}</span></button>)}</div>
        <p className="text-[11px] text-slate-500">{t.usedBy(users)}</p>
        <Table.Root size="1" variant="ghost" className="text-[11px]">
          <Table.Header className="text-[10px] uppercase tracking-wide text-slate-400"><Table.Row><Table.ColumnHeaderCell className="pl-0">{t.value}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t.expected}</Table.ColumnHeaderCell><Table.ColumnHeaderCell/></Table.Row></Table.Header>
          <Table.Body>{rows.map((sample, index) => <Table.Row key={index}>
            <Table.Cell className="pl-0 pr-2"><TextField.Root size="2" aria-label={t.value} value={sample.value} onChange={(event) => setRows(rows.map((item, position) => position === index ? { ...item, value: event.target.value } : item))} className="font-mono"/></Table.Cell>
            <Table.Cell className="w-32 pr-2"><TextField.Root size="2" aria-label={t.expected} type="number" min={100} max={599} value={sample.expectedStatus ?? 200} onChange={(event) => setRows(rows.map((item, position) => position === index ? { ...item, expectedStatus: Number(event.target.value) === 200 ? undefined : Number(event.target.value) } : item))} className="font-mono"/></Table.Cell>
            <Table.Cell className="w-8"><IconButton type="button" size="2" variant="ghost" color="red" aria-label="×" onClick={() => setRows(rows.filter((_, position) => position !== index))}><Trash2 className="size-3.5"/></IconButton></Table.Cell>
          </Table.Row>)}</Table.Body>
        </Table.Root>
        <Button type="button" size="2" variant="surface" color="gray" onClick={() => setRows([...rows, { value: "" }])}><Plus className="size-3.5"/>{t.addValue}</Button>
        {!valid && <Notice tone="warn">{t.invalidSamples}</Notice>}
      </>}
    </GuideFrame>;
  }

  if (step === 2) {
    const writes = operations.filter((operation) => ["POST", "PUT", "PATCH"].includes(operation.method));
    const operation = writes.find((item) => item.id === selected) ?? writes[0];
    const stored = saved?.bodies ?? {};
    const textOf = (id: string) => bodyTexts[id] ?? { body: stored[id]?.body ? JSON.stringify(stored[id].body, null, 2) : "", replaceBody: stored[id]?.replaceBody ? JSON.stringify(stored[id].replaceBody, null, 2) : "" };
    const problems = Object.entries(bodyTexts).flatMap(([id, texts]) => [[`${id}.body`, parseObject(texts.body).error], [`${id}.replaceBody`, parseObject(texts.replaceBody).error]]).filter(([, problem]) => problem).map(([name, problem]) => t.invalidJson(String(name), String(problem)));
    const dirty = Object.keys(bodyTexts).length > 0;
    const save = async () => {
      const next: Bodies = { ...stored };
      for (const [id, texts] of Object.entries(bodyTexts)) {
        const body = parseObject(texts.body).value;
        const replaceBody = parseObject(texts.replaceBody).value;
        if (body || replaceBody) next[id] = { ...(body ? { body } : {}), ...(replaceBody ? { replaceBody } : {}) };
        else delete next[id];
      }
      await saveSection("bodies", next);
      setBodyTexts({});
    };
    const texts = operation ? textOf(operation.id) : null;
    const edit = (patch: Partial<{ body: string; replaceBody: string }>) => operation && setBodyTexts({ ...bodyTexts, [operation.id]: { ...textOf(operation.id), ...patch } });
    return <GuideFrame {...frame} title={t.bodiesTitle} intro={t.bodiesIntro} canNext={!problems.length} next={dirty ? save : undefined} nextLabel={dirty ? t.saveAndNext : undefined} doc="funcional"
      example={<Example code={`"createOrder": {\n  "body": { "reference": "ORD-TEST-0001",\n            "customer_id": 1, "total": 42.5 }\n},\n"replaceOrder": {\n  "body":        { "reference": "ORD-TEST-0001", "total": 42.5 },\n  "replaceBody": { "reference": "ORD-TEST-0002", "total": 50 }\n},\n"updateOrder": { "body": { "total": 45 } }`}/>}>
      {!writes.length ? <Notice>{t.noWrites}</Notice> : <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <ul className="max-h-96 space-y-1 overflow-auto">{writes.map((item) => <li key={item.id}><button type="button" onClick={() => setSelected(item.id)} className={cn(choice(item.id === operation?.id), "w-full px-2 py-1.5")}>
          <span className="flex items-center gap-1.5"><MethodBadge method={item.method}/><span className="truncate font-mono text-[10px]">{item.path}</span></span>
          <span className="mt-0.5 block truncate text-[10px] text-slate-500">{item.id}{bodyTexts[item.id] ? " •" : ""}</span>
        </button></li>)}</ul>
        {operation && texts && <div className="space-y-3">
          <Field label={t.body}><TextArea size="1" value={texts.body} onChange={(event) => edit({ body: event.target.value })} rows={10} spellCheck={false} className="mt-1 font-mono text-[11px] leading-5"/></Field>
          {operation.method === "PUT" && <Field label={t.replaceBody}><TextArea size="1" value={texts.replaceBody} onChange={(event) => edit({ replaceBody: event.target.value })} rows={8} spellCheck={false} className="mt-1 font-mono text-[11px] leading-5"/></Field>}
        </div>}
      </div>}
      {problems.length > 0 && <Notice tone="error">{problems.join("\n")}</Notice>}
    </GuideFrame>;
  }

  if (step === 3) {
    const flows = (matrix.data?.operations ?? []).flatMap((operation) => operation.scenarios.filter((scenario) => scenario.flow !== "request").map((scenario) => ({ operation, scenario })));
    return <GuideFrame {...frame} title={t.flowsTitle} intro={t.flowsIntro} canNext doc="funcional"
      example={<Example code={`POST   /v1/orders              → 201  order_id = 17\nGET    /v1/orders/17           → 200  fields match\nDELETE /v1/orders/17           (cleanup)`}><p>{t.idKey(saved?.envelope?.idFallbackKey ?? "id")}</p></Example>}>
      {matrix.isLoading && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner size="1"/>…</p>}
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
        <Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{flows.map(({ operation, scenario }) => <Table.Row key={`${operation.operationId}:${scenario.id}`}>
          <Table.Cell className="px-3"><MethodBadge method={operation.method}/></Table.Cell>
          <Table.Cell className="px-3 font-mono text-slate-700">{operation.path}</Table.Cell>
          <Table.Cell className="px-3 text-slate-900">{scenario.name}</Table.Cell>
          <Table.Cell className="px-3 text-slate-500">{t.flowNames[scenario.flow] ?? scenario.flow}</Table.Cell>
          <Table.Cell className="px-3 tabular-nums text-slate-500">{scenario.expectedStatus}</Table.Cell>
        </Table.Row>)}</Table.Body></Table.Root>
      </div>
    </GuideFrame>;
  }

  if (step === 4) {
    const current = plugins ?? saved?.plugins ?? {};
    const pagination = current.pagination;
    const geo = current.geo;
    const set = (next: Plugins) => setPlugins(next);
    const withPlugin = <K extends keyof Plugins>(key: K, value: Plugins[K] | undefined): Plugins => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next; };
    const paginationValid = !pagination || (pagination.cursorParam && pagination.invalidValue && validStatus(pagination.expectedStatus));
    const geoValid = !geo || (geo.lat && geo.lon && geo.radius && geo.center.lat && geo.center.lon && geo.radiiKm.length > 0 && validStatus(geo.invalidStatus));
    const setGeo = (patch: Partial<GeoPlugin>) => geo && set({ ...current, geo: { ...geo, ...patch } });
    const paramSelect = (label: string, value: string, onChange: (value: string) => void) => <Field label={label}><Select.Root size="2" value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}><Select.Trigger className="mt-1 flex w-full font-mono"/><Select.Content>{!queryParameters.includes(value) && <Select.Item value={value || NONE}>{value || "—"}</Select.Item>}{queryParameters.map((name) => <Select.Item key={name} value={name} className="font-mono">{name}</Select.Item>)}</Select.Content></Select.Root></Field>;
    const pair = (label: string, point: { lat: string; lon: string } | undefined, onChange: (point: { lat: string; lon: string } | undefined) => void, optional = false) => <Field label={label}><span className="flex gap-2">
      <TextField.Root size="2" aria-label={`${label} lat`} value={point?.lat ?? ""} onChange={(event) => onChange(optional && !event.target.value && !point?.lon ? undefined : { lat: event.target.value, lon: point?.lon ?? "" })} placeholder="40.0000" className="mt-1 min-w-0 flex-1 font-mono"/>
      <TextField.Root size="2" aria-label={`${label} lon`} value={point?.lon ?? ""} onChange={(event) => onChange(optional && !event.target.value && !point?.lat ? undefined : { lat: point?.lat ?? "", lon: event.target.value })} placeholder="-100.0000" className="mt-1 min-w-0 flex-1 font-mono"/>
    </span></Field>;
    return <GuideFrame {...frame} title={t.pluginsTitle} intro={t.pluginsIntro} canNext={Boolean(paginationValid && geoValid)} next={plugins ? async () => { await saveSection("plugins", plugins); setPlugins(null); } : undefined} nextLabel={plugins ? t.saveAndNext : undefined} doc="formato"
      example={<Example code={JSON.stringify({ pagination: { cursorParam: "cursor", invalidValue: "%%invalid-cursor%%", expectedStatus: 422 }, geo: { lat: "lat", lon: "lon", radius: "radius_km", center: { lat: "40.0000", lon: "-100.0000" }, radiiKm: ["1", "20"], emptyPoint: { lat: "0", lon: "0" }, loneRadiusKm: "5", invalidStatus: 422 } }, null, 2)}/>}>
      <Toggle checked={Boolean(pagination)} onChange={(on) => set(withPlugin("pagination", on ? { cursorParam: queryParameters.find((name) => /cursor/i.test(name)) ?? queryParameters[0] ?? "cursor", invalidValue: "%%invalid-cursor%%", expectedStatus: 422 } : undefined))} label={t.pagination} hint={t.paginationHint}/>
      {pagination && <div className="grid gap-3 pl-7 sm:grid-cols-3">
        {paramSelect(t.cursorParam, pagination.cursorParam, (cursorParam) => set({ ...current, pagination: { ...pagination, cursorParam } }))}
        <Field label={t.invalidValue}><TextField.Root size="2" value={pagination.invalidValue} onChange={(event) => set({ ...current, pagination: { ...pagination, invalidValue: event.target.value } })} className="mt-1 font-mono"/></Field>
        <Field label={t.expectedStatus}><TextField.Root size="2" type="number" value={pagination.expectedStatus ?? 422} onChange={(event) => set({ ...current, pagination: { ...pagination, expectedStatus: Number(event.target.value) } })} className="mt-1 font-mono"/></Field>
      </div>}
      <Toggle checked={Boolean(geo)} onChange={(on) => set(withPlugin("geo", on ? { lat: "lat", lon: "lon", radius: "radius_km", center: { lat: "", lon: "" }, radiiKm: ["1", "20"], invalidStatus: 422 } : undefined))} label={t.geo} hint={t.geoHint}/>
      {geo && <div className="grid gap-3 pl-7 sm:grid-cols-3">
        {paramSelect(t.lat, geo.lat, (lat) => setGeo({ lat }))}
        {paramSelect(t.lon, geo.lon, (lon) => setGeo({ lon }))}
        {paramSelect(t.radius, geo.radius, (radius) => setGeo({ radius }))}
        {pair(t.center, geo.center, (center) => setGeo({ center: center ?? { lat: "", lon: "" } }))}
        <Field label={t.radii}><TextField.Root size="2" value={geo.radiiKm.join(", ")} onChange={(event) => setGeo({ radiiKm: event.target.value.split(/[\s,]+/).filter(Boolean) })} placeholder="1, 20" className="mt-1 font-mono"/></Field>
        {pair(t.emptyPoint, geo.emptyPoint, (emptyPoint) => setGeo({ emptyPoint }), true)}
        <Field label={t.loneRadius}><TextField.Root size="2" value={geo.loneRadiusKm ?? ""} onChange={(event) => setGeo({ loneRadiusKm: event.target.value || undefined })} placeholder="5" className="mt-1 font-mono"/></Field>
        <Field label={t.invalidStatus}><TextField.Root size="2" type="number" value={geo.invalidStatus ?? 422} onChange={(event) => setGeo({ invalidStatus: Number(event.target.value) })} className="mt-1 font-mono"/></Field>
      </div>}
      {!(paginationValid && geoValid) && <Notice tone="warn">{t.invalidPlugins}</Notice>}
    </GuideFrame>;
  }

  const list = matrix.data?.operations ?? [];
  return <GuideFrame {...frame} title={t.matrixTitle} intro={t.matrixIntro} canNext={false} hideNext doc="funcional"
    example={<Example><p>{locale === "en" ? "Every case runs with the status, OpenAPI schema and Content-Type assertions, plus latency where a budget covers the operation." : "Cada caso corre con las aserciones de status, schema OpenAPI y Content-Type, más latencia donde un presupuesto cubre la operación."}</p></Example>}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Text as="label" size="1" className="text-[11px] text-slate-600"><Flex gap="2" align="center"><Checkbox size="1" checked={auth} onCheckedChange={(value) => setAuth(value === true)}/>{t.withAuth}</Flex></Text>
      <span className="text-xs font-semibold text-slate-900">{matrix.data ? t.total(matrix.data.total) : "…"}</span>
    </div>
    {matrix.error && <Notice tone="error">{errorText(matrix.error)}</Notice>}
    <ul className="max-h-[30rem] divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200">{list.map((operation) => {
      const expanded = open.includes(operation.operationId);
      return <li key={operation.operationId}>
        <button type="button" onClick={() => setOpen(expanded ? open.filter((id) => id !== operation.operationId) : [...open, operation.operationId])} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-8">
          {expanded ? <ChevronDown className="size-3 text-slate-400"/> : <ChevronRight className="size-3 text-slate-400"/>}
          <MethodBadge method={operation.method}/><span className="min-w-0 flex-1 truncate font-mono text-slate-700">{operation.path}</span><span className="tabular-nums text-slate-500">{operation.scenarios.length}</span>
        </button>
        {expanded && <ul className="bg-slate-50/60 px-9 pb-2">{operation.scenarios.map((scenario) => <li key={scenario.id} className="flex gap-3 py-0.5 text-[11px]"><span className="w-9 tabular-nums font-semibold text-slate-700">{scenario.expectedStatus}</span><span className="text-slate-700">{scenario.name}</span><span className="truncate text-slate-400">{scenario.description}</span></li>)}</ul>}
      </li>;
    })}</ul>
    <Button type="button" size="2" onClick={() => onDone("functional")}>{t.run}</Button>
  </GuideFrame>;
}
