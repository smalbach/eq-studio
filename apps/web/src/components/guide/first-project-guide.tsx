import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Flex, Link, RadioCards, Spinner, Table, Text, TextArea, TextField } from "@radix-ui/themes";
import { FileUp, Lock, Play, PlugZap, RotateCcw } from "lucide-react";
import { parseProjectFile } from "@eq/runner-core";
import { baseUrlOf, documentKind, parseDocument, readImportFiles, specPathFor } from "@/lib/project-documents";
import { CredentialFields, credentialDraftOf, credentialState, EMPTY_CREDENTIAL, type CredentialForm } from "@/components/guide/credential-fields";
import { Example, Field, fetchMatrix, GuideFrame, isActive, Notice, ProbeOutcome, readTarget, RunProgress, useGuideDraft, useRunPoll, errorText } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import type { Environment } from "@/components/environment/use-environment";
import { API, type ProbeResult } from "@/lib/api";
import { KEYS, type Workspace } from "@/lib/use-workspace";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    nameTitle: "¿Cómo se llama la API?", nameIntro: "El nombre del proyecto: lo verás en la cabecera, en los reportes y en el archivo .eq.json.", name: "Nombre del proyecto", nameHint: "Algo que distinga esta API de las demás. Lo puedes cambiar después.",
    contractTitle: "El contrato", contractIntro: "El contrato de la API: OpenAPI 3.0 o 3.1, Swagger 2.0 (se convierte a OpenAPI 3) o una colección de Postman v2.1 (se genera un OpenAPI 3 desde sus solicitudes). De él salen las operaciones, sus status y parámetros, y una primera configuración de casos.",
    fromExample: "Usar un ejemplo", fromExampleHint: "Un proyecto completo contra la API de ejemplo incluida.", fromUrl: "URL del contrato", fromUrlHint: "El API de Endpoint Quality lee el documento: sin CORS de por medio.", fromFile: "Archivo o texto", fromFileHint: "Un OpenAPI o Swagger en JSON o YAML, una colección de Postman (con su entorno, si quieres) o un .eq.json exportado.",
    specUrl: "URL del contrato", specUrlHint: "Por ejemplo http://127.0.0.1:4010/openapi.json. Debe ser alcanzable desde el equipo donde corre el API.",
    file: "Elegir archivo", paste: "o pega el documento", parsed: (kind: string) => `Documento reconocido: ${kind}.`, notOpenApi: "No es un OpenAPI 3, un Swagger 2.0, una colección de Postman ni un archivo .eq.json.",
    kinds: { openapi: "OpenAPI 3", project: ".eq.json", swagger: "Swagger 2.0 — se convertirá a OpenAPI 3.0", postman: "colección de Postman — se generará un OpenAPI 3 con schemas inferidos de sus ejemplos", "postman-environment": "entorno de Postman — elige también la colección" } as Record<string, string>,
    environmentFile: (name: string, url: string) => `Entorno de Postman «${name}»${url ? `: la URL base será ${url}` : ""}.`,
    converted: { swagger: "El contrato era Swagger 2.0 y se convirtió a OpenAPI 3.0.", postman: "El contrato se generó desde una colección de Postman: los schemas se infirieron de sus ejemplos. Revísalos antes de confiar en la validación." } as Record<string, string>,
    examples: "Ejemplos incluidos", operations: (n: number) => `${n} operaciones`, environments: (n: number) => `${n} entornos`, loadingExamples: "Leyendo los ejemplos…",
    mockHint: "El ejemplo apunta a la API de ejemplo incluida. «pnpm run dev» ya la arranca en los puertos 4010 (sin autenticación) y 4011 (con autenticación); por separado: «pnpm run mock» y «pnpm run mock:auth».",
    created: (name: string) => `Proyecto «${name}» creado.`, createdNext: "Siguiente continúa con este proyecto.", startOver: "Empezar de nuevo", create: "Crear el proyecto",
    summaryTitle: "Operaciones detectadas", summaryIntro: "Lo que se leyó del contrato y la configuración que se generó a partir de él.",
    byTag: "Por tag", needAuth: "Exigen credencial", bodies: "Bodies generados", cases: "Casos en la matriz", warnings: "Advertencias de la importación", noOperations: "El contrato no declara operaciones: revisa el documento.",
    envTitle: "El primer entorno", envIntro: "Dónde corre la API. La conexión se prueba con una solicitud GET real que envía el API de Endpoint Quality.",
    chooseEnv: "Entornos del proyecto", envName: "Nombre", baseUrl: "URL base de la API", baseUrlHint: "La raíz de la API, sin la ruta de las operaciones.", envSpec: "Documento OpenAPI", envSpecHint: "Ruta bajo la URL base o URL absoluta. Se lee en cada corrida para validar los schemas.",
    saveEnv: "Crear entorno", test: "Probar conexión", testing: "Probando…", reached: "La API respondió: hay conexión.", unreached: "No hubo respuesta HTTP: revisa la URL, el puerto y la red (VPN, firewall).", noTarget: "No hay un GET sin parámetros para probar: puedes continuar sin la prueba.",
    skipTest: "Continuar sin probar la conexión",
    credTitle: "La credencial principal", credIntro: "La que presentan los casos normales. Es opcional: sáltala si la API no pide autenticación.", skip: "Saltar", saveAndNext: "Guardar y seguir",
    runTitle: "Primera corrida", runIntro: "Una verificación de solo lectura: todos los casos de las operaciones GET. No escribe nada, así que es segura en cualquier entorno.",
    start: "Ejecutar verificación de solo lectura", running: "Ejecutando en el servidor…", finished: (status: string) => `Corrida terminada: ${status}.`, open: "Ver los resultados", scope: "Guía: verificación de solo lectura",
    statuses: { passed: "pasó", failed: "con fallos", cancelled: "cancelada", interrupted: "interrumpida", error: "error" } as Record<string, string>,
  },
  en: {
    nameTitle: "What is the API called?", nameIntro: "The project's name: you will see it in the header, the reports and the .eq.json file.", name: "Project name", nameHint: "Something that tells this API apart from the others. You can change it later.",
    contractTitle: "The contract", contractIntro: "The API's contract: OpenAPI 3.0 or 3.1, Swagger 2.0 (converted to OpenAPI 3) or a Postman collection v2.1 (an OpenAPI 3 is generated from its requests). The operations, their statuses and parameters, and a first configuration of cases come from it.",
    fromExample: "Use an example", fromExampleHint: "A complete project against the bundled example API.", fromUrl: "Contract URL", fromUrlHint: "The Endpoint Quality API reads the document: no CORS involved.", fromFile: "File or text", fromFileHint: "An OpenAPI or Swagger in JSON or YAML, a Postman collection (with its environment, if you like) or an exported .eq.json.",
    specUrl: "Contract URL", specUrlHint: "For example http://127.0.0.1:4010/openapi.json. It must be reachable from the machine where the API runs.",
    file: "Choose file", paste: "or paste the document", parsed: (kind: string) => `Document recognized: ${kind}.`, notOpenApi: "Not an OpenAPI 3, Swagger 2.0 or Postman collection document, nor a .eq.json file.",
    kinds: { openapi: "OpenAPI 3", project: ".eq.json", swagger: "Swagger 2.0 — it will be converted to OpenAPI 3.0", postman: "Postman collection — an OpenAPI 3 will be generated with schemas inferred from its examples", "postman-environment": "Postman environment — pick the collection too" } as Record<string, string>,
    environmentFile: (name: string, url: string) => `Postman environment "${name}"${url ? `: the base URL will be ${url}` : ""}.`,
    converted: { swagger: "The contract was Swagger 2.0 and was converted to OpenAPI 3.0.", postman: "The contract was generated from a Postman collection: schemas were inferred from its examples. Review them before trusting the validation." } as Record<string, string>,
    examples: "Bundled examples", operations: (n: number) => `${n} operations`, environments: (n: number) => `${n} environments`, loadingExamples: "Reading the examples…",
    mockHint: "The example points at the bundled example API. \"pnpm run dev\" already starts it on ports 4010 (no authentication) and 4011 (authentication); on their own: \"pnpm run mock\" and \"pnpm run mock:auth\".",
    created: (name: string) => `Project "${name}" created.`, createdNext: "Next goes on with this project.", startOver: "Start over", create: "Create the project",
    summaryTitle: "Detected operations", summaryIntro: "What was read from the contract and the configuration generated from it.",
    byTag: "By tag", needAuth: "Need a credential", bodies: "Generated bodies", cases: "Cases in the matrix", warnings: "Import warnings", noOperations: "The contract declares no operations: check the document.",
    envTitle: "The first environment", envIntro: "Where the API runs. The connection is tested with a real GET request sent by the Endpoint Quality API.",
    chooseEnv: "The project's environments", envName: "Name", baseUrl: "API base URL", baseUrlHint: "The root of the API, without the operations' path.", envSpec: "OpenAPI document", envSpecHint: "A path under the base URL or an absolute URL. Read on every run to validate schemas.",
    saveEnv: "Create environment", test: "Test connection", testing: "Testing…", reached: "The API answered: it is reachable.", unreached: "No HTTP answer: check the URL, the port and the network (VPN, firewall).", noTarget: "There is no GET without parameters to test with: you can go on without the test.",
    skipTest: "Go on without testing the connection",
    credTitle: "The primary credential", credIntro: "The one normal cases present. It is optional: skip it if the API asks for no authentication.", skip: "Skip", saveAndNext: "Save and continue",
    runTitle: "First run", runIntro: "A read-only check: every case of the GET operations. It writes nothing, so it is safe in any environment.",
    start: "Run the read-only check", running: "Running on the server…", finished: (status: string) => `Run finished: ${status}.`, open: "See the results", scope: "Guide: read-only check",
    statuses: { passed: "passed", failed: "with failures", cancelled: "cancelled", interrupted: "interrupted", error: "error" } as Record<string, string>,
  },
});

type Source = "example" | "url" | "file";
type Draft = { name: string; source: Source; example: string; specUrl: string; projectId: string; projectName: string; baseUrlGuess: string; warnings: string[]; sourceFormat?: string | null; environment: string; tested: boolean; skipTest: boolean; runId: string };
const INITIAL: Draft = { name: "", source: "example", example: "", specUrl: "", projectId: "", projectName: "", baseUrlGuess: "", warnings: [], sourceFormat: null, environment: "", tested: false, skipTest: false, runId: "" };

/**
 * The way in: from nothing to a first saved run. The project is created at the contract step,
 * so every later step works on something real and the guide can be left and resumed — its
 * answers are kept in this browser, its step in the URL.
 */
export function FirstProjectGuide({ guide, workspace, env, step, onStep, onDone }: { guide: GuideEntry; workspace: Workspace; env: Environment; step: number; onStep: (step: number) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [draft, update, reset] = useGuideDraft<Draft>("first-project", INITIAL);
  const [text, setText] = useState("");
  const [postmanEnvironment, setPostmanEnvironment] = useState<{ name: string; baseUrl?: string; variables: Record<string, string> } | null>(null);
  const [fileError, setFileError] = useState("");
  const [credential, setCredential] = useState<CredentialForm>(EMPTY_CREDENTIAL);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState("");
  const [testing, setTesting] = useState(false);
  const [newEnv, setNewEnv] = useState({ name: "", baseUrl: "", specUrl: "" });
  const projectId = draft.projectId;
  // A step past the contract needs the project the contract step created.
  const current = !projectId && step > 1 ? 1 : step;

  const examples = useQuery({ queryKey: KEYS.examples, queryFn: API.examples, enabled: current === 1 });
  const operations = useQuery({ queryKey: ["guide-operations", projectId], queryFn: () => API.operations(projectId), enabled: Boolean(projectId) && current === 2 });
  const config = useQuery({ queryKey: ["guide-config", projectId], queryFn: () => API.config(projectId), enabled: Boolean(projectId) && current === 2 });
  const matrix = useQuery({ queryKey: ["guide-matrix", projectId, locale], queryFn: () => fetchMatrix(projectId, false, locale), enabled: Boolean(projectId) && current >= 2 });
  const environments = useQuery({ queryKey: KEYS.environments(projectId), queryFn: () => API.environments(projectId), enabled: Boolean(projectId) && current >= 3 });
  const { run, error: runError } = useRunPoll(current === 5 && draft.runId ? draft.runId : null);

  let parsed: { document: unknown; kind: ReturnType<typeof documentKind> } | null = null;
  if (draft.source === "file" && text.trim()) {
    try { const document = parseDocument(text); parsed = { document, kind: documentKind(document) }; } catch { parsed = { document: null, kind: null }; }
  }
  const go = (next: number) => onStep(next);
  const envList = environments.data ?? [];
  const chosen = envList.find((item) => item.environmentId === draft.environment || item.id === draft.environment);

  /** Opens the new project and moves on. The step changes first: while the workspace had no
   * project the shell showed this guide as its only screen, and the URL must say "guide" before
   * the project appears or the shell would leave the guide. */
  async function created(id: string, name: string, warnings: string[] = [], baseUrlGuess = "", sourceFormat: string | null = null) {
    // The conversion is said once, in the reader's language, by `sourceFormat`.
    update({ projectId: id, projectName: name, warnings: warnings.filter((warning) => !/^(Converted from Swagger 2\.0|Generated from a Postman collection)/.test(warning)), baseUrlGuess, sourceFormat, environment: "", tested: false, skipTest: false, runId: "" });
    go(2);
    workspace.open(id);
    await workspace.refresh();
  }

  async function createProject() {
    if (projectId) return true;
    const name = draft.name.trim();
    if (draft.source === "example") {
      const imported = await API.importExample(draft.example);
      const example = examples.data?.find((item) => item.id === draft.example);
      if (name && name !== example?.name) await API.updateProject(imported.id, { name });
      await created(imported.id, name || example?.name || imported.slug);
      return false;
    }
    if (draft.source === "url") {
      const result = await API.createProject({ name, spec: { url: draft.specUrl.trim() } });
      let origin = "";
      try { origin = new URL(draft.specUrl).origin; } catch { /* checked by the step's validation */ }
      await created(result.id, name, result.warnings, result.baseUrl ?? origin, result.sourceFormat);
      return false;
    }
    if (!parsed?.kind || parsed.kind === "postman-environment") return false;
    if (parsed.kind === "project") {
      const file = parseProjectFile(parsed.document);
      const imported = await API.importProject({ ...file, project: { ...file.project, name: name || file.project.name } });
      await created(imported.id, name || file.project.name);
      return false;
    }
    const result = await API.createProject({ name, spec: { document: parsed.document } });
    await created(result.id, name, result.warnings, postmanEnvironment?.baseUrl || result.baseUrl || baseUrlOf(parsed.document, undefined, postmanEnvironment?.variables), result.sourceFormat);
    return false;
  }

  async function createEnvironment() {
    const baseUrl = (newEnv.baseUrl || draft.baseUrlGuess).trim().replace(/\/$/, "");
    const specUrl = newEnv.specUrl.trim() || specPathFor(draft.specUrl || undefined, baseUrl);
    const createdEnv = await API.createEnvironment(projectId, { name: newEnv.name.trim() || baseUrl.replace(/^https?:\/\//, ""), baseUrl, ...(specUrl ? { specUrl } : {}) });
    update({ environment: createdEnv.key, tested: false, skipTest: false });
    await workspace.refresh();
  }

  async function testConnection() {
    if (!chosen) return;
    setTesting(true); setProbe(null); setProbeError("");
    try {
      const target = readTarget(matrix.data ?? await fetchMatrix(projectId, false, locale));
      if (!target) { setProbeError(t.noTarget); return; }
      const result = await API.probe(projectId, { environment: chosen.environmentId, operationId: target.operation.operationId, scenarioId: target.scenario.id, locale });
      setProbe(result);
      update({ tested: result.steps.some((item) => item.actual !== null) });
    } catch (failure) {
      setProbeError(errorText(failure));
    } finally {
      setTesting(false);
    }
  }

  /** The chosen environment becomes the one the rest of the app points at. */
  function pointAtEnvironment() {
    if (chosen && env.projectId === projectId) env.selectEnvironment(chosen);
  }

  async function saveCredential() {
    const draftCredential = credentialDraftOf(credential);
    if (!draftCredential || !chosen) return true;
    await API.setCredential(projectId, chosen.environmentId, "primary", draftCredential);
    await workspace.refresh();
    setCredential(EMPTY_CREDENTIAL);
    return true;
  }

  async function startRun() {
    if (!chosen) return;
    const started = await API.startRun(projectId, { environment: chosen.environmentId, readOnly: true, scope: t.scope, locale });
    update({ runId: started.id });
  }

  const frame = { guide, step: current, onStep: go, maxStep: projectId ? 5 : 1 };

  if (current === 0) return <GuideFrame {...frame} title={t.nameTitle} intro={t.nameIntro} canNext={draft.name.trim().length > 1} doc="conceptos"
    example={<Example code={`{\n  "name": "Store API"\n}`}><p>{locale === "en" ? "A fictional store: products, orders and their items." : "Una tienda ficticia: productos, pedidos y sus líneas."}</p></Example>}>
    <Field label={t.name} hint={t.nameHint}><TextField.Root size="2" value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Store API" className="mt-1 font-mono"/></Field>
  </GuideFrame>;

  if (current === 1) {
    const valid = Boolean(projectId) || (draft.source === "example" ? Boolean(draft.example) : draft.source === "url" ? /^https?:\/\/\S+$/.test(draft.specUrl.trim()) : Boolean(parsed?.kind) && parsed?.kind !== "postman-environment");
    return <GuideFrame {...frame} title={t.contractTitle} intro={t.contractIntro} canNext={valid} next={createProject} nextLabel={projectId ? undefined : t.create} doc="formato"
      example={<Example code={draft.source === "url" ? "http://127.0.0.1:4010/openapi.json" : `openapi: 3.1.0\ninfo: { title: Store API, version: 1.0.0 }\nservers: [{ url: "http://127.0.0.1:4010" }]\npaths:\n  /v1/orders:\n    get:\n      operationId: listOrders\n      tags: [orders]\n      responses: { "200": { description: OK } }`}>
        <p>{draft.source === "example" ? t.mockHint : draft.source === "url" ? t.specUrlHint : t.fromFileHint}</p>
      </Example>}>
      {projectId ? <Notice tone="ok">{t.created(draft.projectName)} {t.createdNext}<Link asChild size="1" weight="bold" underline="always" className="ml-2 inline-flex items-center gap-1"><button type="button" onClick={reset}><RotateCcw className="size-3"/>{t.startOver}</button></Link></Notice> : <>
        <RadioCards.Root size="1" value={draft.source} onValueChange={(source) => update({ source: source as Source })} columns={{ initial: "1", sm: "3" }} gap="2">{([["example", t.fromExample, t.fromExampleHint], ["url", t.fromUrl, t.fromUrlHint], ["file", t.fromFile, t.fromFileHint]] as const).map(([id, label, hint]) =>
          <RadioCards.Item key={id} value={id} className="justify-start text-left text-[11px]"><span><span className="block text-xs font-semibold text-slate-900">{label}</span><span className="mt-0.5 block text-slate-500">{hint}</span></span></RadioCards.Item>)}</RadioCards.Root>
        {draft.source === "example" && <div>
          <p className="mb-1 text-[11px] font-medium text-slate-600">{t.examples}</p>
          {examples.isLoading && <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Spinner size="1"/>{t.loadingExamples}</p>}
          {examples.error && <Notice tone="error">{errorText(examples.error)}</Notice>}
          <RadioCards.Root size="1" value={draft.example} onValueChange={(example) => update({ example })} columns={{ initial: "1", sm: "2" }} gap="2">{(examples.data ?? []).map((example) => <RadioCards.Item key={example.id} value={example.id} className="justify-start text-left text-[11px]"><span>
            <span className="block text-xs font-semibold text-slate-900">{example.name}</span>
            <span className="mt-0.5 block text-slate-500">{t.operations(example.operations)} · {t.environments(example.environments.length)}</span>
            <span className="mt-1 block font-mono text-[10px] text-slate-400">{example.environments.map((item) => item.baseUrl).join(" · ")}</span>
          </span></RadioCards.Item>)}</RadioCards.Root>
          <Notice className="mt-3">{t.mockHint}</Notice>
        </div>}
        {draft.source === "url" && <Field label={t.specUrl} hint={t.specUrlHint}><TextField.Root size="2" type="url" value={draft.specUrl} onChange={(event) => update({ specUrl: event.target.value })} placeholder="http://127.0.0.1:4010/openapi.json" className="mt-1 font-mono"/></Field>}
        {draft.source === "file" && <div className="space-y-2">
          <Button asChild size="2" variant="surface" color="gray"><label className="cursor-pointer"><FileUp className="size-3.5"/>{t.file}<input type="file" multiple accept=".json,.yaml,.yml,application/json" className="sr-only" onChange={async (event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; setFileError(""); try { const read = await readImportFiles(files, locale); if (read.environment) setPostmanEnvironment(read.environment); if (read.contract) setText(JSON.stringify(read.contract.document, null, 2)); } catch (failure) { setFileError(errorText(failure)); } }}/></label></Button>
          <Field label={t.paste}><TextArea size="1" value={text} onChange={(event) => setText(event.target.value)} rows={9} spellCheck={false} className="mt-1 font-mono text-[11px] leading-5" placeholder={"openapi: 3.1.0\ninfo: …"}/></Field>
          {parsed && (parsed.kind ? <Notice tone={parsed.kind === "openapi" || parsed.kind === "project" ? "ok" : "warn"}>{t.parsed(t.kinds[parsed.kind])}</Notice> : <Notice tone="error">{t.notOpenApi}</Notice>)}
          {postmanEnvironment && <Notice>{t.environmentFile(postmanEnvironment.name, postmanEnvironment.baseUrl ?? "")}</Notice>}
          {fileError && <Notice tone="error">{fileError}</Notice>}
        </div>}
      </>}
    </GuideFrame>;
  }

  if (current === 2) {
    const list = operations.data ?? [];
    const publicOperations = new Set(config.data?.config.auth?.publicOperations ?? []);
    const tags = Object.entries(list.reduce<Record<string, number>>((counts, operation) => ({ ...counts, [operation.tag]: (counts[operation.tag] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    const needAuth = list.filter((operation) => !publicOperations.has(operation.id) && operation.statuses.some((status) => status === 401 || status === 403));
    const bodies = Object.keys(config.data?.config.bodies ?? {});
    const loading = operations.isLoading || config.isLoading;
    return <GuideFrame {...frame} title={t.summaryTitle} intro={t.summaryIntro} canNext={list.length > 0} doc="funcional"
      example={<Example code={`{ "id": "getOrder", "method": "GET",\n  "path": "/v1/orders/{order_id}",\n  "tag": "orders",\n  "statuses": [200, 401, 404],\n  "parameters": ["order_id"] }`}><p>{locale === "en" ? "Each declared status enables its cases: a 404 gives a \"missing resource\" case, a 401 a \"no credential\" one." : "Cada status declarado habilita sus casos: un 404 da el caso «recurso inexistente», un 401 el de «sin credencial»."}</p></Example>}>
      {loading && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner size="1"/>…</p>}
      {(operations.error || config.error) && <Notice tone="error">{errorText(operations.error ?? config.error)}</Notice>}
      {!loading && !list.length && <Notice tone="warn">{t.noOperations}</Notice>}
      {list.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-4">
          {[[list.length, locale === "en" ? "Operations" : "Operaciones"], [needAuth.length, t.needAuth], [bodies.length, t.bodies], [matrix.data?.total ?? "…", t.cases]].map(([value, label]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>)}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-600">{t.byTag}</p>
          <div className="flex flex-wrap gap-1.5">{tags.map(([tag, count]) => <Badge key={tag} size="1" variant="soft" color="gray">{tag} <strong className="tabular-nums">{count}</strong></Badge>)}</div>
        </div>
        <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
          <Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{list.map((operation) => <Table.Row key={operation.id}>
            <Table.Cell className="px-3 font-mono font-semibold text-slate-700">{operation.method}</Table.Cell>
            <Table.Cell className="px-3 font-mono text-slate-700">{operation.path}</Table.Cell>
            <Table.Cell className="px-3 text-slate-500">{operation.statuses.join(" · ")}</Table.Cell>
            <Table.Cell className="px-3 text-slate-500"><span className="flex items-center gap-1">{needAuth.includes(operation) && <Lock className="size-3" aria-label={t.needAuth}/>}{bodies.includes(operation.id) && <span title={t.bodies} className="font-mono">{"{…}"}</span>}</span></Table.Cell>
          </Table.Row>)}</Table.Body></Table.Root>
        </div>
        {draft.sourceFormat && t.converted[draft.sourceFormat] && <Notice tone="warn">{t.converted[draft.sourceFormat]}</Notice>}
        {draft.warnings.length > 0 && <Notice tone="warn"><strong>{t.warnings}</strong>{"\n"}{draft.warnings.join("\n")}</Notice>}
      </>}
    </GuideFrame>;
  }

  if (current === 3) {
    const canCreate = /^https?:\/\/\S+$/.test((newEnv.baseUrl || draft.baseUrlGuess).trim());
    return <GuideFrame {...frame} title={t.envTitle} intro={t.envIntro} canNext={Boolean(chosen) && (draft.tested || draft.skipTest)} next={() => { pointAtEnvironment(); }} doc="problemas"
      example={<Example code={`{ "name": "Local",\n  "baseUrl": "http://127.0.0.1:4010",\n  "specUrl": "/openapi.json" }`}><p>{locale === "en" ? "Local, disposable environments are seeded and allow writes by default; anything else starts read-only." : "Los entornos locales y desechables tienen el seed y permiten escrituras por defecto; cualquier otro empieza en solo lectura."}</p></Example>}>
      {environments.isLoading && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner size="1"/>…</p>}
      {envList.length > 0 && <div>
        <p className="mb-1 text-[11px] font-medium text-slate-600">{t.chooseEnv}</p>
        <RadioCards.Root size="1" value={chosen?.environmentId ?? ""} onValueChange={(environment) => { update({ environment, tested: false, skipTest: false }); setProbe(null); setProbeError(""); }} columns={{ initial: "1", sm: "2" }} gap="2">{envList.map((item) => <RadioCards.Item key={item.environmentId} value={item.environmentId} className="justify-start text-left text-[11px]"><span>
          <span className="block text-xs font-semibold text-slate-900">{item.name}</span><span className="mt-0.5 block font-mono text-[10px] text-slate-500">{item.baseUrl}</span>
        </span></RadioCards.Item>)}</RadioCards.Root>
      </div>}
      {!envList.length && !environments.isLoading && <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label={t.envName}><TextField.Root size="2" value={newEnv.name} onChange={(event) => setNewEnv({ ...newEnv, name: event.target.value })} placeholder="Local" className="mt-1 font-mono"/></Field>
        <Field label={t.baseUrl} hint={t.baseUrlHint}><TextField.Root size="2" type="url" value={newEnv.baseUrl || draft.baseUrlGuess} onChange={(event) => setNewEnv({ ...newEnv, baseUrl: event.target.value })} placeholder="http://127.0.0.1:4010" className="mt-1 font-mono"/></Field>
        <Field label={t.envSpec} hint={t.envSpecHint} className="sm:col-span-2"><TextField.Root size="2" value={newEnv.specUrl} onChange={(event) => setNewEnv({ ...newEnv, specUrl: event.target.value })} placeholder="/openapi.json" className="mt-1 font-mono"/></Field>
        <div className="sm:col-span-2"><Button type="button" size="2" disabled={!canCreate} onClick={() => { createEnvironment().catch((failure) => setProbeError(errorText(failure))); }}>{t.saveEnv}</Button></div>
      </div>}
      {chosen && <div className="space-y-2">
        <Button type="button" size="2" variant="surface" color="gray" disabled={testing} onClick={() => { void testConnection(); }}>{testing ? <Spinner size="1"/> : <PlugZap className="size-3.5"/>}{testing ? t.testing : t.test}</Button>
        {probe && <Notice tone={draft.tested ? "ok" : "error"}>{draft.tested ? t.reached : t.unreached}</Notice>}
        {probe && <ProbeOutcome result={probe}/>}
        {!draft.tested && <Text as="label" size="1" className="block text-[11px] text-slate-500"><Flex gap="2" align="center"><Checkbox size="1" checked={draft.skipTest} onCheckedChange={(value) => update({ skipTest: value === true })}/>{t.skipTest}</Flex></Text>}
      </div>}
      {probeError && <Notice tone="error">{probeError}</Notice>}
    </GuideFrame>;
  }

  if (current === 4) {
    const state = credentialState(credential);
    return <GuideFrame {...frame} title={t.credTitle} intro={t.credIntro} canNext={state !== "incomplete"} next={saveCredential} nextLabel={state === "empty" ? t.skip : t.saveAndNext} doc="conceptos"
      example={<Example code={`Authorization: Bearer <token>\nX-API-Key: <key>`}><p>{locale === "en" ? "The bundled mock on port 4011 accepts \"admin-token\" as its bearer token. The value is encrypted by the API and never shown again: at most its last four characters." : "El mock incluido en el puerto 4011 acepta «admin-token» como token bearer. El valor lo cifra el API y no se vuelve a mostrar: como mucho sus cuatro últimos caracteres."}</p></Example>}>
      <CredentialFields value={credential} onChange={setCredential}/>
    </GuideFrame>;
  }

  const done = run && !isActive(run);
  return <GuideFrame {...frame} title={t.runTitle} intro={t.runIntro} canNext={false} hideNext doc="funcional"
    example={<Example><p>{locale === "en" ? "Passed: every assertion held. Failed: the API answered something else — a finding. Blocked: a write that was not sent because the environment does not allow writes." : "Pasó: todas sus aserciones se cumplieron. Falló: la API respondió otra cosa — un hallazgo. Bloqueado: una escritura que no se envió porque el entorno no permite escrituras."}</p></Example>}>
    {!draft.runId && <Button type="button" size="2" disabled={!chosen} onClick={() => { startRun().catch((failure) => setProbeError(errorText(failure))); }}><Play className="size-3.5"/>{t.start}</Button>}
    {draft.runId && !run && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner size="1"/>{t.running}</p>}
    {run && <>
      {!done && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner size="1"/>{t.running}</p>}
      <RunProgress run={run}/>
      {done && <Notice tone={run.status === "passed" ? "ok" : "warn"}>{t.finished(t.statuses[run.status] ?? run.status)}{run.error ? `\n${run.error}` : ""}</Notice>}
      {done && <Button type="button" size="2" onClick={() => { reset(); onDone("functional"); }}>{t.open}</Button>}
    </>}
    {(runError || probeError) && <Notice tone="error">{runError || probeError}</Notice>}
  </GuideFrame>;
}
