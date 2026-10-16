import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, RadioCards, Spinner, Text, TextField } from "@radix-ui/themes";
import { CircleCheck, RefreshCw } from "lucide-react";
import { PendingLink, useSyncStatus } from "@/components/account/sync-card";
import { errorText, Example, Field, GuideFrame, Notice, Toggle, useGuideDraft } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import { API, type SyncResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    cloudTitle: "¿Con qué nube?", cloudIntro: "Sincronizar deja el mismo proyecto en varios equipos: proyectos, entornos, versiones del contrato y corridas terminadas viajan por un workspace en la nube. Cada equipo sigue trabajando sin conexión con su copia; los cambios viajan en la siguiente sincronización.",
    inCloud: "Estás en la app de la nube: aquí no hay nada que enlazar. La sincronización se configura desde la app local (Ajustes → Sincronización, o esta misma guía allí) o con «eq login <url>» en la terminal.",
    url: "URL de la nube", urlHint: "La dirección del despliegue en la nube, la misma que abres en el navegador para iniciar sesión.",
    device: "Nombre de este equipo", deviceHint: "Así aparecerá en la nube. Vacío = el nombre del equipo.",
    linkTitle: "Enlazar este equipo", linkIntro: "Se abre la nube en el navegador, inicias sesión y apruebas este equipo con el código que verás aquí. El equipo recibe un token propio que puedes revocar desde la nube.",
    start: "Empezar a enlazar", linked: (workspace: string, url: string) => `Enlazado al workspace «${workspace}» de ${url}.`,
    useToken: "Enlazar con un token de API", tokenHint: "Para un servidor o una máquina sin navegador: un token eqt_… creado en Ajustes → Tokens de API de la nube.",
    otherUrl: (url: string) => `Esta instalación ya está enlazada a ${url}. Para cambiar de nube, desenlázala primero en Ajustes → Sincronización.`,
    whatTitle: "¿Qué se sincroniza?", whatIntro: "Los proyectos, sus entornos y las versiones del contrato viajan siempre. Las corridas y la elección de proyectos son tuyas.",
    runs: "Incluir el historial de corridas", runsHint: "Las corridas terminadas, con sus resultados, para verlas desde cualquier equipo. Apágalo si solo quieres compartir la configuración: las corridas ocupan más que todo lo demás.",
    allProjects: "Todos los proyectos", allHint: "Los de ahora y los que vengan.", someProjects: "Solo algunos", someHint: "Los demás se quedan solo en este equipo.", noProjects: "Todavía no hay proyectos en este equipo.",
    secretsTitle: "¿Y las credenciales?", secretsIntro: "Por defecto se quedan en este equipo: los entornos viajan sin ellas y en cada equipo se escriben otra vez.",
    secretsHint: "Con una frase de paso viajan cifradas de extremo a extremo: se cifran aquí y la nube nunca ve su valor. Todos los equipos deben usar la misma frase (el primero la fija). Si la pierdes, no hay forma de recuperarlas: habrá que volver a escribir las credenciales.",
    passphrase: "Frase de paso", passphraseHint: "Al menos 12 caracteres. No se guarda en el navegador: escríbela en un gestor de contraseñas.", secretsOn: "Las credenciales de este equipo ya viajan cifradas.", short: "Al menos 12 caracteres.",
    skip: "Saltar", enable: "Activar y seguir", skipHint: "Puedes saltar este paso y activarlo más tarde en Ajustes → Sincronización.",
    syncTitle: "Primera sincronización", syncIntro: "Envía lo que hay aquí y recibe lo que hay en la nube. Después, cada vez que la pidas (o sola, si el servidor la tiene programada).",
    syncNow: "Sincronizar ahora", syncing: "Sincronizando…", result: (r: SyncResult) => `Listo en ${(r.durationMs / 1000).toFixed(1)} s: ↓ ${r.pulled} recibidos · ↑ ${r.pushed} enviados · ${r.conflicts} conflictos.`,
    rejected: "La nube rechazó:", conflicts: "Hay conflictos: dos equipos cambiaron lo mismo. Elige qué valor se queda en Ajustes → Sincronización.", finish: "Terminar",
  },
  en: {
    cloudTitle: "Which cloud?", cloudIntro: "Sync keeps the same project on several machines: projects, environments, contract versions and finished runs travel through a cloud workspace. Each machine keeps working offline with its copy; changes travel on the next sync.",
    inCloud: "You are in the cloud app: there is nothing to link here. Sync is set up from the local app (Settings → Sync, or this same guide there) or with \"eq login <url>\" in the terminal.",
    url: "Cloud URL", urlHint: "The address of the cloud deployment, the one you open in the browser to sign in.",
    device: "This machine's name", deviceHint: "How it shows in the cloud. Empty = the machine's name.",
    linkTitle: "Link this machine", linkIntro: "The cloud opens in the browser, you sign in and approve this machine with the code shown here. The machine gets a token of its own that you can revoke from the cloud.",
    start: "Start linking", linked: (workspace: string, url: string) => `Linked to the "${workspace}" workspace of ${url}.`,
    useToken: "Link with an API token", tokenHint: "For a server or a machine without a browser: an eqt_… token created in the cloud's Settings → API tokens.",
    otherUrl: (url: string) => `This installation is already linked to ${url}. To change clouds, unlink it first in Settings → Sync.`,
    whatTitle: "What syncs?", whatIntro: "Projects, their environments and contract versions always travel. Runs and the choice of projects are up to you.",
    runs: "Include run history", runsHint: "Finished runs, with their results, to see them from any machine. Turn it off to share only the configuration: runs take more room than everything else.",
    allProjects: "All projects", allHint: "Today's and the ones to come.", someProjects: "Only some", someHint: "The rest stay on this machine only.", noProjects: "There are no projects on this machine yet.",
    secretsTitle: "And the credentials?", secretsIntro: "By default they stay on this machine: environments travel without them and are filled in again on each machine.",
    secretsHint: "With a passphrase they travel end-to-end encrypted: they are encrypted here and the cloud never sees their value. Every device must use the same passphrase (the first one sets it). If you lose it there is no way to recover them: the credentials have to be entered again.",
    passphrase: "Passphrase", passphraseHint: "At least 12 characters. It is not kept in the browser: write it down in a password manager.", secretsOn: "This machine's credentials already travel encrypted.", short: "At least 12 characters.",
    skip: "Skip", enable: "Turn on and continue", skipHint: "You can skip this step and turn it on later in Settings → Sync.",
    syncTitle: "First sync", syncIntro: "Sends what is here and receives what is in the cloud. After that, whenever you ask (or by itself, if the server has it scheduled).",
    syncNow: "Sync now", syncing: "Syncing…", result: (r: SyncResult) => `Done in ${(r.durationMs / 1000).toFixed(1)} s: ↓ ${r.pulled} pulled · ↑ ${r.pushed} pushed · ${r.conflicts} conflicts.`,
    rejected: "The cloud refused:", conflicts: "There are conflicts: two machines changed the same thing. Choose which value stays in Settings → Sync.", finish: "Finish",
  },
});

type Draft = { url: string; deviceName: string; useToken: boolean; includeRuns: boolean | null; projects: string[] | null | "unset" };

/**
 * Linking a local installation to a cloud workspace, then what travels, the secrets and a first
 * sync. Every step reads the real status of the link, so it can be left halfway (the browser
 * sign-in, say) and resumed. The passphrase and the token are never kept in the draft.
 */
export function SyncGuide({ guide, step, onStep, onDone }: { guide: GuideEntry; step: number; onStep: (step: number) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const session = useSession();
  const local = session.status === "local";
  const client = useQueryClient();
  const status = useSyncStatus(local);
  const projects = useQuery({ queryKey: ["projects"], queryFn: API.projects, enabled: local });
  const [draft, update] = useGuideDraft<Draft>("sync", { url: "", deviceName: "", useToken: false, includeRuns: null, projects: "unset" });
  const [token, setToken] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);

  const sync = status.data;
  const linked = Boolean(sync?.linked);
  const validUrl = /^https?:\/\/[^\s/]+/.test(draft.url.trim());
  const frame = { guide, step, onStep, maxStep: linked ? 4 : validUrl ? 1 : 0 };
  const includeRuns = draft.includeRuns ?? sync?.includeRuns ?? true;
  const selection = draft.projects === "unset" ? sync?.projects ?? null : draft.projects;
  const slugs = (ids: string[]) => ids.map((id) => projects.data?.find((item) => item.id === id)?.slug ?? id).join(",");

  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); await client.invalidateQueries({ queryKey: ["sync"] }); }
  }

  if (step === 0) return <GuideFrame {...frame} title={t.cloudTitle} intro={t.cloudIntro} canNext={local && (validUrl || linked)} hideNext={!local} doc="sync"
    example={<Example code="eq login https://eq.example.com"/>}>
    {!local ? <Notice>{t.inCloud}</Notice> : <>
      {linked && sync?.url && <Notice tone="ok">{t.linked(sync.workspace?.name ?? "", sync.url)}</Notice>}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label={t.url} hint={t.urlHint}><TextField.Root size="2" type="url" value={draft.url} disabled={linked} onChange={(event) => update({ url: event.target.value })} placeholder={sync?.url ?? "https://eq.example.com"} className="mt-1 font-mono"/></Field>
        <Field label={t.device} hint={t.deviceHint}><TextField.Root size="2" value={draft.deviceName} disabled={linked} onChange={(event) => update({ deviceName: event.target.value })} placeholder={sync?.deviceName} className="mt-1 font-mono"/></Field>
      </div>
    </>}
  </GuideFrame>;

  if (step === 1) return <GuideFrame {...frame} title={t.linkTitle} intro={t.linkIntro} canNext={linked} hideNext={!linked} doc="sync"
    example={<Example code={"eq login https://eq.example.com\n\n# without a browser (CI, a server):\nEQ_SYNC_TOKEN=eqt_… eq login https://eq.example.com"}/>}>
    {!sync ? <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner size="2"/></p>
      : linked ? <>
        <Notice tone="ok">{t.linked(sync.workspace?.name ?? "", sync.url ?? "")}</Notice>
        {validUrl && sync.url && !sync.url.startsWith(draft.url.trim().replace(/\/$/, "")) && <Notice tone="warn">{t.otherUrl(sync.url)}</Notice>}
      </>
      : sync.pending ? <PendingLink status={sync} busy={busy} onCancel={() => { void run(async () => { await API.syncUnlink(); }); }}/>
      : <>
        <p className="font-mono text-xs text-slate-700">{draft.url}</p>
        <Toggle checked={draft.useToken} onChange={(useToken) => update({ useToken })} label={t.useToken} hint={t.tokenHint}/>
        {draft.useToken && <Field label="Token"><TextField.Root size="2" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="eqt_…" className="mt-1 font-mono"/></Field>}
        <Button type="button" size="2" disabled={busy || !validUrl || (draft.useToken && !token.trim())} onClick={() => { void run(async () => {
          client.setQueryData(["sync", "status"], await API.syncLink({ url: draft.url.trim(), token: draft.useToken ? token.trim() : undefined, deviceName: draft.deviceName.trim() || undefined }));
          setToken("");
        }); }}>{busy && <Spinner size="1"/>}{t.start}</Button>
        {sync.lastError && <Notice tone="error">{sync.lastError}</Notice>}
      </>}
    {error && <Notice tone="error">{error}</Notice>}
  </GuideFrame>;

  if (step === 2) return <GuideFrame {...frame} title={t.whatTitle} intro={t.whatIntro} canNext={linked && (selection === null || selection.length > 0)} doc="sync"
    next={async () => { await API.syncConfigure({ includeRuns, projects: selection }); await client.invalidateQueries({ queryKey: ["sync"] }); }}
    example={<Example code={`eq sync --runs ${includeRuns ? "on" : "off"} --projects ${selection?.length ? slugs(selection) : "all"}\n\n# for example:\neq sync --runs off --projects store-api`}/>}>
    <Toggle checked={includeRuns} onChange={(value) => update({ includeRuns: value })} label={t.runs} hint={t.runsHint}/>
    <RadioCards.Root size="1" value={selection === null ? "all" : "some"} onValueChange={(scope) => update({ projects: scope === "all" ? null : selection ?? [] })} columns={{ initial: "1", sm: "2" }} gap="2">
      <RadioCards.Item value="all" className="justify-start text-left text-[11px]"><span><span className="block text-xs font-semibold text-slate-900">{t.allProjects}</span><span className="mt-0.5 block text-slate-500">{t.allHint}</span></span></RadioCards.Item>
      <RadioCards.Item value="some" className="justify-start text-left text-[11px]"><span><span className="block text-xs font-semibold text-slate-900">{t.someProjects}</span><span className="mt-0.5 block text-slate-500">{t.someHint}</span></span></RadioCards.Item>
    </RadioCards.Root>
    {selection !== null && (projects.data?.length
      ? <ul className="grid gap-1.5">{projects.data.map((project) => <li key={project.id}><Text as="label" size="1" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"><Checkbox size="1" checked={selection.includes(project.id)} onCheckedChange={(value) => update({ projects: value === true ? [...selection, project.id] : selection.filter((id) => id !== project.id) })}/>{project.name}<span className="font-mono text-[10px] text-slate-400">{project.slug}</span></Text></li>)}</ul>
      : <Notice>{t.noProjects}</Notice>)}
  </GuideFrame>;

  if (step === 3) {
    const tooShort = passphrase.length > 0 && passphrase.length < 12;
    return <GuideFrame {...frame} title={t.secretsTitle} intro={t.secretsIntro} canNext={linked && !tooShort} nextLabel={sync?.secrets ? undefined : passphrase ? t.enable : t.skip} doc="sync"
      next={async () => {
        if (!passphrase || sync?.secrets) return;
        client.setQueryData(["sync", "status"], await API.syncConfigure({ passphrase }));
        setPassphrase("");
      }}
      example={<Example code={"# never as an argument: it would stay in the shell history\nEQ_SYNC_PASSPHRASE=… eq sync --secrets on"}/>}>
      <Notice tone="warn">{t.secretsHint}</Notice>
      {sync?.secrets ? <Notice tone="ok">{t.secretsOn}</Notice> : <>
        <Field label={t.passphrase} hint={tooShort ? t.short : t.passphraseHint}><TextField.Root size="2" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1 font-mono"/></Field>
        {!passphrase && <p className="text-[11px] text-slate-500">{t.skipHint}</p>}
      </>}
    </GuideFrame>;
  }

  return <GuideFrame {...frame} title={t.syncTitle} intro={t.syncIntro} canNext={false} hideNext doc="sync"
    example={<Example code="eq sync"/>}>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="2" disabled={busy || !linked || sync?.syncing} onClick={() => { void run(async () => setResult(await API.syncRun())); }}><RefreshCw className={busy || sync?.syncing ? "size-3.5 animate-spin" : "size-3.5"}/>{busy ? t.syncing : t.syncNow}</Button>
      {result && <Button type="button" size="2" variant="surface" color="gray" onClick={() => onDone("home")}><CircleCheck className="size-3.5"/>{t.finish}</Button>}
    </div>
    {result && <Notice tone={result.rejected.length ? "warn" : "ok"}>{t.result(result)}{result.rejected.length > 0 && `\n${t.rejected}\n${result.rejected.map((item) => `${item.type} ${item.id}: ${item.error}`).join("\n")}`}</Notice>}
    {result && result.conflicts > 0 && <Notice tone="warn">{t.conflicts}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </GuideFrame>;
}
