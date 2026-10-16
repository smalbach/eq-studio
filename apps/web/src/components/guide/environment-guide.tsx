import { useState } from "react";
import { Button, Checkbox, Flex, RadioCards, Table, Text, TextField } from "@radix-ui/themes";
import { CircleCheck } from "lucide-react";
import { settingsOf, type Environment } from "@/components/environment/use-environment";
import { errorText, Example, Field, GuideFrame, Notice, Toggle, useGuideDraft } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import { API, type EnvironmentView } from "@/lib/api";
import { isLoopback } from "@/lib/format";
import type { Workspace } from "@/lib/use-workspace";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    addressTitle: "¿Dónde corre la API?", addressIntro: "Elige un entorno del proyecto para revisarlo, o crea uno nuevo.", newEnv: "Nuevo entorno",
    name: "Nombre", baseUrl: "URL base", baseUrlHint: "La raíz de la API. Las solicitudes las envía el API de Endpoint Quality: «localhost» es el equipo donde corre.", specUrl: "Documento OpenAPI", specUrlHint: "Ruta bajo la URL base o URL absoluta. Vacío = /openapi.json.",
    seedTitle: "¿Tiene el seed del proyecto?", seedIntro: "Los casos se escriben contra un seed donde el id 1 existe y el 999999 no.",
    seeded: "El entorno tiene el seed del proyecto", seededHint: "Sí para una base local o desechable que arranca siempre igual. No para un entorno compartido: antes de cada corrida se leen ids reales (seed.sources) y se mapean sobre los del seed.",
    writesTitle: "¿Se permite escribir?", writesIntro: "Los casos de POST, PUT, PATCH y DELETE crean y borran datos. Apagado, el motor no los envía: quedan bloqueados, no fallidos.",
    writes: "Permitir escrituras", writesHint: "Cada flujo borra lo que creó, aunque falle; aun así, en un entorno compartido son datos que otros ven mientras la corrida dura.",
    confirm: (name: string) => `Entiendo que en «${name}», que no tiene el seed, las corridas crearán y borrarán datos reales.`, confirmNeeded: "Confirma para permitir escrituras en un entorno sin seed.",
    latencyTitle: "¿Deciden los presupuestos de latencia?", latencyIntro: "Un presupuesto es una promesa del servicio, medida a su lado.",
    latency: "Exigir presupuestos de latencia", latencyHint: "Apágalo si llegas a la API a través de una VPN o un gateway: el camino añade decenas o cientos de milisegundos y todo saldría en rojo por la red, no por la API. La latencia se sigue mostrando.",
    suggestion: (on: boolean): string => on ? "Sugerencia para esta URL: activado (es local)." : "Sugerencia para esta URL: desactivado (no es local).",
    authTitle: "¿Exige autenticación?", authIntro: "Habilita los casos 401 (sin credencial) y 403 (credencial insuficiente) de cada operación protegida.",
    auth: "La API exige credenciales en este entorno", authHint: "Contra una API que deja pasar a todos, los casos 401/403 fallarían por un motivo ajeno al endpoint. Configura las credenciales con la guía de credenciales.",
    saveTitle: "Revisar y guardar", saveIntro: "Así quedará el entorno.", save: "Guardar entorno", saved: "Entorno guardado: la app apunta ahora a él.", credentials: "Configurar credenciales", finish: "Terminar",
    on: "sí", off: "no",
  },
  en: {
    addressTitle: "Where does the API run?", addressIntro: "Pick one of the project's environments to review it, or create a new one.", newEnv: "New environment",
    name: "Name", baseUrl: "Base URL", baseUrlHint: "The root of the API. Requests are sent by the Endpoint Quality API: \"localhost\" is the machine it runs on.", specUrl: "OpenAPI document", specUrlHint: "A path under the base URL or an absolute URL. Empty = /openapi.json.",
    seedTitle: "Does it hold the project's seed?", seedIntro: "Cases are written against a seed where id 1 exists and 999999 does not.",
    seeded: "The environment holds the project's seed", seededHint: "Yes for a local or disposable database that always starts the same. No for a shared environment: before each run real ids are read (seed.sources) and mapped onto the seed's.",
    writesTitle: "May it be written to?", writesIntro: "POST, PUT, PATCH and DELETE cases create and delete data. Off, the engine does not send them: they are blocked, not failed.",
    writes: "Allow writes", writesHint: "Every flow deletes what it created, even when it fails; still, in a shared environment that is data others see while the run lasts.",
    confirm: (name: string) => `I understand that in "${name}", which does not hold the seed, runs will create and delete real data.`, confirmNeeded: "Confirm to allow writes in an environment without the seed.",
    latencyTitle: "Do latency budgets decide?", latencyIntro: "A budget is a promise of the service, measured next to it.",
    latency: "Enforce latency budgets", latencyHint: "Turn it off if you reach the API through a VPN or a gateway: the path adds tens or hundreds of milliseconds and everything would be red because of the network, not the API. Latency is still shown.",
    suggestion: (on: boolean): string => on ? "Suggestion for this URL: on (it is local)." : "Suggestion for this URL: off (it is not local).",
    authTitle: "Does it enforce authentication?", authIntro: "Enables the 401 (no credential) and 403 (insufficient credential) cases of every protected operation.",
    auth: "The API enforces credentials in this environment", authHint: "Against an API that lets everyone in, the 401/403 cases would fail for a reason unrelated to the endpoint. Set the credentials up with the credentials guide.",
    saveTitle: "Review and save", saveIntro: "This is how the environment will be.", save: "Save environment", saved: "Environment saved: the app now points at it.", credentials: "Set up credentials", finish: "Finish",
    on: "yes", off: "no",
  },
});

type Draft = { target: string; name: string; baseUrl: string; specUrl: string; seeded: boolean; writesAllowed: boolean; enforceLatency: boolean; authEnabled: boolean; confirmWrites: boolean };
const NEW = "new";

/** One environment, switch by switch, each with the reason it exists. Saved at the end. */
export function EnvironmentGuide({ guide, workspace, env, step, onStep, onGuide, onDone }: { guide: GuideEntry; workspace: Workspace; env: Environment; step: number; onStep: (step: number) => void; onGuide: (guide: string) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const fromEnvironment = (environment = env.active): Draft => {
    const settings = settingsOf(environment);
    return environment
      ? { target: environment.environmentId, name: environment.name, baseUrl: environment.baseUrl, specUrl: environment.specUrl ?? "", ...settings, confirmWrites: false }
      : { target: NEW, name: "", baseUrl: "", specUrl: "", ...settingsOf(undefined), confirmWrites: false };
  };
  const [draft, update] = useGuideDraft<Draft>(`environment:${env.projectId}`, fromEnvironment());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const existing = env.environments.find((item) => item.environmentId === draft.target);
  const validUrl = /^https?:\/\/[^\s/]+/.test(draft.baseUrl.trim());
  const label = draft.name.trim() || draft.baseUrl.replace(/^https?:\/\//, "");
  const frame = { guide, step, onStep, maxStep: validUrl ? 5 : 0 };
  const yes = (value: boolean) => value ? t.on : t.off;

  /** A new address resets the switches to what that kind of URL implies, as the API would. */
  const setBaseUrl = (baseUrl: string) => {
    const local = isLoopback(baseUrl);
    update(existing ? { baseUrl } : { baseUrl, seeded: local, writesAllowed: local, enforceLatency: local });
  };

  async function save() {
    setError("");
    const changes = { name: label, baseUrl: draft.baseUrl.trim().replace(/\/$/, ""), specUrl: draft.specUrl.trim() || null, seeded: draft.seeded, writesAllowed: draft.writesAllowed, enforceLatency: draft.enforceLatency, authEnabled: draft.authEnabled };
    try {
      if (existing) {
        await API.updateEnvironment(env.projectId, existing.environmentId, { ...changes, expectedRev: existing.rev });
        env.selectEnvironment(existing);
      } else {
        const created = await API.createEnvironment(env.projectId, { ...changes, specUrl: changes.specUrl ?? undefined });
        // The hook only needs the key to remember the choice; the list catches up on refresh.
        env.selectEnvironment({ id: created.key } as EnvironmentView);
        update({ target: created.id });
      }
      await workspace.refresh();
      setSaved(true);
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  const sample = (fields: Partial<Draft>) => JSON.stringify({ name: "Staging", baseUrl: "https://staging.example.com", ...fields }, null, 2);

  if (step === 0) return <GuideFrame {...frame} title={t.addressTitle} intro={t.addressIntro} canNext={validUrl} doc="conceptos"
    example={<Example code={`{\n  "name": "Staging",\n  "baseUrl": "https://staging.example.com",\n  "specUrl": "/openapi.json"\n}`}/>}>
    <RadioCards.Root size="1" value={draft.target} onValueChange={(target) => { update(target === NEW ? { ...fromEnvironment(undefined), target: NEW } : fromEnvironment(env.environments.find((item) => item.environmentId === target))); setSaved(false); }} columns={{ initial: "1", sm: "3" }} gap="2">
      {env.environments.map((item) => <RadioCards.Item key={item.environmentId} value={item.environmentId} className="justify-start text-left text-[11px]"><span className="min-w-0"><span className="block text-xs font-semibold text-slate-900">{item.name}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">{item.baseUrl}</span></span></RadioCards.Item>)}
      <RadioCards.Item value={NEW} className="justify-start text-left text-[11px]"><span className="block text-xs font-semibold text-slate-900">+ {t.newEnv}</span></RadioCards.Item>
    </RadioCards.Root>
    <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
      <Field label={t.name}><TextField.Root size="2" value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Staging" className="mt-1 font-mono"/></Field>
      <Field label={t.baseUrl} hint={t.baseUrlHint}><TextField.Root size="2" type="url" value={draft.baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://staging.example.com" className="mt-1 font-mono"/></Field>
      <Field label={t.specUrl} hint={t.specUrlHint} className="sm:col-span-2"><TextField.Root size="2" value={draft.specUrl} onChange={(event) => update({ specUrl: event.target.value })} placeholder="/openapi.json" className="mt-1 font-mono"/></Field>
    </div>
  </GuideFrame>;

  if (step === 1) return <GuideFrame {...frame} title={t.seedTitle} intro={t.seedIntro} canNext doc="funcional"
    example={<Example code={sample({ seeded: false })}><p>{locale === "en" ? "A shared staging environment: its ids are whatever its database holds." : "Un staging compartido: sus ids son los que tenga su base de datos."}</p></Example>}>
    <Toggle checked={draft.seeded} onChange={(seeded) => update({ seeded, ...(seeded ? {} : { writesAllowed: false, confirmWrites: false }) })} label={t.seeded} hint={t.seededHint}/>
  </GuideFrame>;

  if (step === 2) {
    const needsConfirm = draft.writesAllowed && !draft.seeded;
    return <GuideFrame {...frame} title={t.writesTitle} intro={t.writesIntro} canNext={!needsConfirm || draft.confirmWrites} doc="funcional"
      example={<Example code={sample({ seeded: false, writesAllowed: false })}/>}>
      <Toggle checked={draft.writesAllowed} onChange={(writesAllowed) => update({ writesAllowed, confirmWrites: false })} label={t.writes} hint={t.writesHint}/>
      {needsConfirm && <Text as="label" size="1" className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900"><Flex gap="2" align="start"><Checkbox color="amber" checked={draft.confirmWrites} onCheckedChange={(value) => update({ confirmWrites: value === true })} className="mt-0.5"/>{t.confirm(label)}</Flex></Text>}
      {needsConfirm && !draft.confirmWrites && <Notice tone="warn">{t.confirmNeeded}</Notice>}
    </GuideFrame>;
  }

  if (step === 3) return <GuideFrame {...frame} title={t.latencyTitle} intro={t.latencyIntro} canNext doc="problemas"
    example={<Example code={sample({ enforceLatency: false })}/>}>
    <Toggle checked={draft.enforceLatency} onChange={(enforceLatency) => update({ enforceLatency })} label={t.latency} hint={t.latencyHint}/>
    <Notice>{t.suggestion(isLoopback(draft.baseUrl))}</Notice>
  </GuideFrame>;

  if (step === 4) return <GuideFrame {...frame} title={t.authTitle} intro={t.authIntro} canNext doc="funcional"
    example={<Example code={sample({ authEnabled: true })}/>}>
    <Toggle checked={draft.authEnabled} onChange={(authEnabled) => update({ authEnabled })} label={t.auth} hint={t.authHint}/>
  </GuideFrame>;

  const rows: [string, string][] = [[t.name, label], [t.baseUrl, draft.baseUrl], [t.specUrl, draft.specUrl || "/openapi.json"], [t.seeded, yes(draft.seeded)], [t.writes, yes(draft.writesAllowed)], [t.latency, yes(draft.enforceLatency)], [t.auth, yes(draft.authEnabled)]];
  return <GuideFrame {...frame} title={t.saveTitle} intro={t.saveIntro} canNext={false} hideNext doc="conceptos"
    example={<Example code={JSON.stringify({ name: label, baseUrl: draft.baseUrl, specUrl: draft.specUrl || undefined, seeded: draft.seeded, writesAllowed: draft.writesAllowed, enforceLatency: draft.enforceLatency, authEnabled: draft.authEnabled }, null, 2)}/>}>
    <Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{rows.map(([name, value]) => <Table.Row key={name}><Table.RowHeaderCell className="pr-4 font-normal text-slate-500">{name}</Table.RowHeaderCell><Table.Cell className="font-mono text-slate-800">{value}</Table.Cell></Table.Row>)}</Table.Body></Table.Root>
    {saved ? <div className="space-y-3">
      <Notice tone="ok">{t.saved}</Notice>
      <div className="flex flex-wrap gap-2">
        {draft.authEnabled && <Button type="button" size="2" onClick={() => onGuide("credentials")}>{t.credentials}</Button>}
        <Button type="button" size="2" variant="surface" color="gray" onClick={() => onDone("home")}><CircleCheck className="size-3.5"/>{t.finish}</Button>
      </div>
    </div> : <Button type="button" size="2" disabled={!validUrl} onClick={() => { void save(); }}>{t.save}</Button>}
    {error && <Notice tone="error">{error}</Notice>}
  </GuideFrame>;
}
