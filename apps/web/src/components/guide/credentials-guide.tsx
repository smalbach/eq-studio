import { useState } from "react";
import { Button, Link, RadioCards, Spinner } from "@radix-ui/themes";
import { PlugZap } from "lucide-react";
import type { Environment } from "@/components/environment/use-environment";
import { credentialDraftOf, EMPTY_CREDENTIAL, KindPicker, ValueFields, type CredentialForm } from "@/components/guide/credential-fields";
import { choice, errorText, Example, fetchMatrix, GuideFrame, Notice, ProbeOutcome, useGuideDraft, type Matrix } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import { API, type CredentialRole, type ProbeResult } from "@/lib/api";
import type { Workspace } from "@/lib/use-workspace";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    environment: "Entorno", kindTitle: "¿Qué tipo de credencial?", kindIntro: "Cómo se autentica la API. Las credenciales son de un entorno: cada uno tiene las suyas.",
    valueTitle: "El valor", valueIntro: "Se cifra al guardarse; después solo verás sus cuatro últimos caracteres. Al volver a esta guía tendrás que escribirlo de nuevo: nunca se guarda en el navegador.",
    roleTitle: "¿Para qué casos?", roleIntro: "Cada entorno tiene hasta tres credenciales, una por rol. Guardar reemplaza la que hubiera en ese rol.",
    roles: {
      primary: ["Principal", "La que presentan los casos normales y las pruebas de carga."],
      insufficient: ["Insuficiente (403)", "Válida pero sin permisos suficientes: los casos «scope insuficiente» deben recibir 403."],
      alternate: ["Alternativa (401)", "Una credencial que algunas operaciones no aceptan (una API key en un DELETE): los casos de auth.alternate esperan 401."],
    } as Record<CredentialRole, [string, string]>,
    current: (kind: string, last: string) => `Ahora: ${kind}${last ? ` ····${last}` : ""}`, save: "Guardar credencial",
    testTitle: "Probarla", testIntro: "Una solicitud real contra una operación protegida, con el caso que corresponde al rol. No se guarda nada.",
    test: "Probar", testing: "Probando…", target: (name: string) => `Operación de prueba: ${name}`, noTarget: "El contrato no tiene una operación protegida con un caso para este rol: la credencial se usará igual en las corridas.",
    writeWarning: "Esta prueba envía una escritura. Si la credencial tuviera más permisos de los que debería, la solicitud se ejecutaría de verdad.", writesBlocked: "La única operación de prueba es una escritura y el entorno no permite escrituras: pruébala desde una corrida en un entorno desechable.",
    passed: { primary: "Aceptada: la operación respondió como en un caso normal.", insufficient: "Correcto: la API la rechazó con el status esperado.", alternate: "Correcto: la operación no acepta esta credencial." } as Record<CredentialRole, string>,
    failed: { primary: "No pasó. Un 401 o 403 indica que la credencial no vale aquí (vencida, otro entorno, otra cabecera).", insufficient: "No pasó: la API no respondió el 403 esperado. ¿Tiene esta credencial más permisos de la cuenta?", alternate: "No pasó: la operación no respondió el status esperado para una credencial que no acepta." } as Record<CredentialRole, string>,
    another: "Configurar otra credencial", finish: "Terminar", sendAnyway: "Enviar de todos modos", toEnvironment: "Guía de entorno", authOff: "Este entorno tiene la autenticación desactivada: los casos 401/403 no corren. Actívala en la guía de entorno.",
  },
  en: {
    environment: "Environment", kindTitle: "What kind of credential?", kindIntro: "How the API authenticates. Credentials belong to an environment: each one has its own.",
    valueTitle: "The value", valueIntro: "It is encrypted when saved; afterwards you only see its last four characters. Coming back to this guide you will have to type it again: it is never kept in the browser.",
    roleTitle: "For which cases?", roleIntro: "Each environment has up to three credentials, one per role. Saving replaces whatever that role held.",
    roles: {
      primary: ["Primary", "The one normal cases and load tests present."],
      insufficient: ["Insufficient (403)", "Valid but without enough permissions: the \"insufficient scope\" cases must get a 403."],
      alternate: ["Alternate (401)", "A credential some operations do not accept (an API key on a DELETE): the auth.alternate cases expect a 401."],
    } as Record<CredentialRole, [string, string]>,
    current: (kind: string, last: string) => `Now: ${kind}${last ? ` ····${last}` : ""}`, save: "Save credential",
    testTitle: "Test it", testIntro: "A real request against a protected operation, with the case that fits the role. Nothing is saved.",
    test: "Test", testing: "Testing…", target: (name: string) => `Test operation: ${name}`, noTarget: "The contract has no protected operation with a case for this role: the credential will still be used by runs.",
    writeWarning: "This test sends a write. If the credential had more permissions than it should, the request would really run.", writesBlocked: "The only test operation is a write and the environment does not allow writes: test it from a run in a disposable environment.",
    passed: { primary: "Accepted: the operation answered as in a normal case.", insufficient: "Correct: the API rejected it with the expected status.", alternate: "Correct: the operation does not accept this credential." } as Record<CredentialRole, string>,
    failed: { primary: "It did not pass. A 401 or 403 means the credential is not valid here (expired, another environment, another header).", insufficient: "It did not pass: the API did not answer the expected 403. Does this credential have more permissions than it should?", alternate: "It did not pass: the operation did not answer the expected status for a credential it does not accept." } as Record<CredentialRole, string>,
    another: "Set up another credential", finish: "Finish", sendAnyway: "Send it anyway", toEnvironment: "Environment guide", authOff: "This environment has authentication off: the 401/403 cases do not run. Turn it on in the environment guide.",
  },
});

/** The case that tests each role, and the operation to run it on: reads first, a GET list best. */
function testTarget(matrix: Matrix, role: CredentialRole) {
  const scenarioId = role === "insufficient" ? "auth-insufficient" : role === "alternate" ? "auth-api-key" : null;
  const rank = (method: string, path: string) => (method === "GET" ? 0 : 2) + (path.includes("{") ? 1 : 0);
  const candidates = matrix.operations.flatMap((operation) => {
    if (scenarioId) {
      const scenario = operation.scenarios.find((item) => item.id === scenarioId);
      return scenario ? [{ operation, scenario }] : [];
    }
    // The primary credential is tested where it matters: an operation that declares a 401, so
    // it is protected, with its plain case.
    if (!operation.scenarios.some((item) => item.id === "auth-none")) return [];
    const scenario = operation.scenarios.find((item) => item.flow === "request" && (!item.auth || item.auth === "default") && !item.parameters);
    return scenario ? [{ operation, scenario }] : [];
  });
  return candidates.sort((a, b) => rank(a.operation.method, a.operation.path) - rank(b.operation.method, b.operation.path))[0] ?? null;
}

type Draft = Omit<CredentialForm, "secret"> & { role: CredentialRole };
const INITIAL: Draft = { kind: EMPTY_CREDENTIAL.kind, headerName: "", username: "", tokenUrl: "", clientId: "", scope: "", role: "primary" };

/** One credential: its kind, its value, the role it plays, and a probe that shows it works. */
export function CredentialsGuide({ guide, workspace, env, step, onStep, onGuide, onDone }: { guide: GuideEntry; workspace: Workspace; env: Environment; step: number; onStep: (step: number) => void; onGuide: (guide: string) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [draft, update, reset] = useGuideDraft<Draft>("credentials", INITIAL);
  // The secret lives only here, never in the resumable draft.
  const [secret, setSecret] = useState("");
  const [target, setTarget] = useState<ReturnType<typeof testTarget> | undefined>(undefined);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const form: CredentialForm = { ...draft, secret };
  const setForm = (value: CredentialForm) => { const { secret: typed, ...rest } = value; setSecret(typed); update(rest); };
  const frame = { guide, step, onStep, maxStep: step };
  const current = (role: CredentialRole) => env.credentials.find((item) => item.role === role);

  const environmentPicker = <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">{t.environment}:
    {env.environments.map((item) => <button key={item.environmentId} type="button" onClick={() => env.selectEnvironment(item)} className={choice(item.environmentId === env.environmentId)}><span className="font-semibold text-slate-900">{item.name}</span> <span className="font-mono text-[10px]">{item.baseUrl}</span></button>)}
  </div>;

  async function save() {
    const value = credentialDraftOf(form);
    if (!value) return false;
    await API.setCredential(env.projectId, env.environmentId, draft.role, value);
    setSecret("");
    await workspace.refresh();
    return true;
  }

  /** Finds the operation to test on; a write is only sent after the user saw the warning. */
  async function test(confirmed = false) {
    setTesting(true); setResult(null); setError("");
    try {
      const found = confirmed && target ? target : testTarget(await fetchMatrix(env.projectId, true, locale), draft.role);
      setTarget(found);
      if (!found || (found.operation.method !== "GET" && (!env.writesAllowed || !confirmed))) return;
      setResult(await API.probe(env.projectId, { environment: env.environmentId, operationId: found.operation.operationId, scenarioId: found.scenario.id, locale }));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setTesting(false);
    }
  }

  if (step === 0) return <GuideFrame {...frame} title={t.kindTitle} intro={t.kindIntro} canNext={Boolean(env.environmentId)} doc="conceptos"
    example={<Example code={`Authorization: Bearer eyJhbGciOi…\nX-API-Key: k_live_…\nAuthorization: Basic dXNlcjpwYXNz`}/>}>
    {environmentPicker}
    <KindPicker value={draft.kind} onChange={(kind) => update({ kind })}/>
    {!env.authEnabled && <Notice tone="warn">{t.authOff}</Notice>}
  </GuideFrame>;

  if (step === 1) return <GuideFrame {...frame} title={t.valueTitle} intro={t.valueIntro} canNext={credentialDraftOf(form) !== null} doc="conceptos"
    example={<Example code={draft.kind === "oauth2_client_credentials" ? `{ "kind": "oauth2_client_credentials",\n  "tokenUrl": "https://auth.example.com/oauth/token",\n  "clientId": "store-ci",\n  "scope": "orders:read" }` : draft.kind === "api_key" ? `{ "kind": "api_key", "headerName": "X-API-Key" }` : draft.kind === "basic" ? `{ "kind": "basic", "username": "qa-bot" }` : `{ "kind": "bearer" }`}/>}>
    <ValueFields value={form} onChange={setForm}/>
  </GuideFrame>;

  if (step === 2) return <GuideFrame {...frame} title={t.roleTitle} intro={t.roleIntro} canNext={credentialDraftOf(form) !== null} next={save} nextLabel={t.save} doc="funcional"
    example={<Example><p>{locale === "en" ? "For an orders API: primary = an admin token, insufficient = a read-only token (writes must answer 403), alternate = an API key that DELETE does not accept (401)." : "Para una API de pedidos: principal = un token de administración, insuficiente = un token de solo lectura (las escrituras deben responder 403), alternativa = una API key que DELETE no acepta (401)."}</p></Example>}>
    <RadioCards.Root size="1" value={draft.role} onValueChange={(role) => update({ role: role as CredentialRole })} columns={{ initial: "1", sm: "3" }} gap="2">{(["primary", "insufficient", "alternate"] as CredentialRole[]).map((role) => {
      const saved = current(role);
      return <RadioCards.Item key={role} value={role} className="justify-start text-left text-[11px]"><span>
        <span className="block text-xs font-semibold text-slate-900">{t.roles[role][0]}</span><span className="mt-0.5 block text-slate-500">{t.roles[role][1]}</span>
        {saved && <span className="mt-1 block font-mono text-[10px] text-slate-400">{t.current(saved.kind, saved.lastFour ?? "")}</span>}
      </span></RadioCards.Item>;
    })}</RadioCards.Root>
    {credentialDraftOf(form) === null && <Notice tone="warn">{t.valueIntro}</Notice>}
  </GuideFrame>;

  const write = target && target.operation.method !== "GET";
  return <GuideFrame {...frame} title={t.testTitle} intro={t.testIntro} canNext={false} hideNext doc="problemas"
    example={<Example><p>{locale === "en" ? "Primary: a protected GET must answer 2xx. Insufficient: a write must answer 403. Alternate: the operations in auth.alternate must answer 401." : "Principal: un GET protegido debe responder 2xx. Insuficiente: una escritura debe responder 403. Alternativa: las operaciones de auth.alternate deben responder 401."}</p></Example>}>
    <Button type="button" size="2" variant="surface" color="gray" disabled={testing} onClick={() => { void test(false); }}>{testing ? <Spinner size="1"/> : <PlugZap className="size-3.5"/>}{testing ? t.testing : t.test}</Button>
    {target === null && <Notice tone="warn">{t.noTarget}</Notice>}
    {target && <p className="font-mono text-[11px] text-slate-600">{t.target(`${target.operation.method} ${target.operation.path} · ${target.scenario.name}`)}</p>}
    {write && (env.writesAllowed ? <Notice tone="warn">{t.writeWarning} <Link asChild size="1" weight="bold" underline="always" color="amber" className="ml-1"><button type="button" disabled={testing} onClick={() => { void test(true); }}>{t.sendAnyway}</button></Link></Notice> : <Notice tone="warn">{t.writesBlocked}</Notice>)}
    {result && <Notice tone={result.ok ? "ok" : "error"}>{result.ok ? t.passed[draft.role] : t.failed[draft.role]}</Notice>}
    {result && <ProbeOutcome result={result}/>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
      <Button type="button" size="2" variant="surface" color="gray" onClick={() => { reset(); onStep(0); }}>{t.another}</Button>
      {!env.authEnabled && <Button type="button" size="2" variant="surface" color="gray" onClick={() => onGuide("environment")}>{t.toEnvironment}</Button>}
      <Button type="button" size="2" onClick={() => { reset(); onDone("home"); }}>{t.finish}</Button>
    </div>
  </GuideFrame>;
}
