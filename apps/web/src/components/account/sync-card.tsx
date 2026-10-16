import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, Callout, Checkbox, Flex, Link, RadioGroup, Spinner, Text, TextField } from "@radix-ui/themes";
import { BookOpen, ChevronDown, CircleAlert, CloudUpload, ExternalLink, KeyRound, RefreshCw, TriangleAlert, Unlink, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ConflictsList, useConflicts } from "@/components/account/conflicts-list";
import { Toggle } from "@/components/guide/guide-kit";
import { API, ApiError, type SyncResult, type SyncStatus } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The cloud's sign-up screen for the URL typed so far, or undefined while it is not a URL. */
function signUpUrl(url: string) {
  try { const target = new URL(url.trim()); return target.protocol.startsWith("http") ? `${target.origin}/?registro` : undefined; } catch { return undefined; }
}

const MESSAGES = defineMessages({
  es: {
    title: "Sincronización", guide: "Guía paso a paso",
    intro: "Enlaza esta instalación a un workspace en la nube y el mismo proyecto queda en varios equipos: proyectos, entornos, versiones del contrato y corridas terminadas. Todo sigue funcionando sin conexión; los cambios viajan en la siguiente sincronización.",
    url: "URL de la nube", urlHint: "La dirección del despliegue en la nube, por ejemplo https://eq.example.com.", device: "Nombre de este equipo", deviceHint: "Así aparecerá en la nube, entre los tokens del workspace. Vacío = el nombre del equipo.",
    useToken: "Enlazar con un token de API", token: "Token de API", tokenHint: "Un token eqt_… creado en Ajustes → Tokens de API de la nube. Enlaza al momento, sin pasar por el navegador.",
    account: "Crear cuenta en la nube", accountHint: "¿Todavía no tienes cuenta? Créala en la nube y vuelve aquí a enlazar. Para probar en este equipo, `pnpm run cloud` levanta una en http://localhost:4500.",
    link: "Enlazar", pendingTitle: "Aprueba este equipo en el navegador", code: "Código", open: (uri: string) => `Abrir ${uri}`,
    pendingHint: "Inicia sesión allí y aprueba este equipo con este código. Esta página se actualiza sola.", expires: "Caduca", cancel: "Cancelar",
    linkedTo: "Enlazado a", as: "como", lastSync: "Última sincronización", never: "nunca", pendingChanges: (n: number) => n === 1 ? "1 cambio por enviar" : `${n} cambios por enviar`,
    auto: (seconds: number) => `Automática cada ${seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`}`, onDemand: "Solo cuando la pides",
    summary: (r: SyncResult) => `↓ ${r.pulled} recibidos · ↑ ${r.pushed} enviados · ${r.conflicts} conflictos · ${r.rejected.length} rechazados`,
    syncNow: "Sincronizar ahora", syncing: "Sincronizando…", rejected: "La nube rechazó:",
    what: "Qué se sincroniza", runs: "Incluir el historial de corridas", runsHint: "Las corridas terminadas, con sus resultados. Apágalo si solo quieres compartir la configuración: ocupan más que todo lo demás.",
    projects: "Proyectos", allProjects: "Todos", someProjects: "Solo los elegidos", saveProjects: "Guardar selección", noProjects: "Todavía no hay proyectos en este equipo.",
    secrets: "Secretos", secretsOn: "Las credenciales viajan cifradas de extremo a extremo.", secretsOff: "Las credenciales se quedan en este equipo.",
    secretsHint: "Con una frase de paso, las credenciales viajan cifradas de extremo a extremo: la nube nunca las ve. Todos los equipos deben usar la misma frase (el primero la fija). Si la pierdes, habrá que volver a escribir las credenciales.",
    passphrase: "Frase de paso (12+ caracteres)", enable: "Activar", disable: "Desactivar en este equipo",
    conflicts: (n: number) => `Conflictos (${n})`, conflictsHint: "Dos equipos cambiaron lo mismo de forma distinta. Se aplicó el valor de la nube; elige cuál se queda.",
    unlink: "Desenlazar", unlinkConfirm: "¿Desenlazar esta instalación? Los datos se quedan en este equipo y su token deja de valer en la nube.",
  },
  en: {
    title: "Sync", guide: "Step-by-step guide",
    intro: "Link this installation to a cloud workspace and the same project lives on several machines: projects, environments, contract versions and finished runs. Everything keeps working offline; changes travel on the next sync.",
    url: "Cloud URL", urlHint: "The address of the cloud deployment, for example https://eq.example.com.", device: "This machine's name", deviceHint: "How it shows in the cloud, among the workspace's tokens. Empty = the machine's name.",
    useToken: "Link with an API token instead", token: "API token", tokenHint: "An eqt_… token created in the cloud's Settings → API tokens. Links right away, without the browser.",
    account: "Create an account in the cloud", accountHint: "No account yet? Create it in the cloud and come back here to link. To try it on this machine, `pnpm run cloud` starts one at http://localhost:4500.",
    link: "Link", pendingTitle: "Approve this device in the browser", code: "Code", open: (uri: string) => `Open ${uri}`,
    pendingHint: "Sign in there and approve this device with this code. This page updates by itself.", expires: "Expires", cancel: "Cancel",
    linkedTo: "Linked to", as: "as", lastSync: "Last sync", never: "never", pendingChanges: (n: number) => n === 1 ? "1 change to send" : `${n} changes to send`,
    auto: (seconds: number) => `Automatic every ${seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`}`, onDemand: "Only on demand",
    summary: (r: SyncResult) => `↓ ${r.pulled} pulled · ↑ ${r.pushed} pushed · ${r.conflicts} conflicts · ${r.rejected.length} refused`,
    syncNow: "Sync now", syncing: "Syncing…", rejected: "The cloud refused:",
    what: "What syncs", runs: "Include run history", runsHint: "Finished runs, with their results. Turn it off to share only the configuration: runs take more room than everything else.",
    projects: "Projects", allProjects: "All", someProjects: "Only the chosen ones", saveProjects: "Save selection", noProjects: "There are no projects on this machine yet.",
    secrets: "Secrets", secretsOn: "Credentials travel end-to-end encrypted.", secretsOff: "Credentials stay on this machine.",
    secretsHint: "With a passphrase, credentials travel end-to-end encrypted: the cloud never sees them. Every device must use the same passphrase (the first one sets it). If you lose it, the credentials have to be entered again.",
    passphrase: "Passphrase (12+ characters)", enable: "Turn on", disable: "Turn off on this machine",
    conflicts: (n: number) => `Conflicts (${n})`, conflictsHint: "Two devices changed the same thing differently. The cloud's value was applied; choose which one stays.",
    unlink: "Unlink", unlinkConfirm: "Unlink this installation? The data stays on this machine and its token stops working in the cloud.",
  },
});

const STATUS_KEY = ["sync", "status"];

/**
 * The status of this installation's link. While a browser sign-in is pending it asks the cloud
 * every three seconds instead of only reading the status: the server polls too, but on its own
 * schedule, and the person is looking at this page waiting for it.
 */
export function useSyncStatus(enabled = true) {
  const client = useQueryClient();
  return useQuery({
    queryKey: STATUS_KEY, enabled,
    queryFn: () => client.getQueryData<SyncStatus>(STATUS_KEY)?.pending ? API.syncCheck() : API.syncStatus(),
    refetchInterval: (query) => query.state.data?.pending ? 3_000 : query.state.data?.syncing ? 2_000 : false,
  });
}

/** The cloud's sign-in, pending: the code to compare and the page where it is approved. */
export function PendingLink({ status, onCancel, busy }: { status: SyncStatus; onCancel: () => void; busy?: boolean }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const pending = status.pending!;
  return <div className="rounded-[var(--radius-4)] border border-accent-6 bg-accent-2 p-4">
    <p className="text-xs font-semibold text-slate-900">{t.pendingTitle}</p>
    <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.code}</p>
    <p className="font-mono text-3xl font-bold tracking-[0.2em] text-slate-950">{pending.userCode}</p>
    <p className="mt-2 text-[11px] leading-4 text-slate-600">{t.pendingHint}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button asChild size="2" variant="solid" className="max-w-full"><a href={pending.verificationUri} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5 shrink-0"/><span className="truncate">{t.open(pending.verificationUri)}</span></a></Button>
      <Button type="button" size="2" variant="surface" color="gray" disabled={busy} onClick={onCancel}>{t.cancel}</Button>
      <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Spinner size="1"/>{t.expires} {formatDate(Date.parse(pending.expiresAt), locale)}</span>
    </div>
  </div>;
}

/**
 * Local Settings → Sync: link, pending sign-in, or linked with what syncs, the secrets and the
 * conflicts. Every change goes through the local API and the status is read again after it.
 */
export function SyncCard() {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const client = useQueryClient();
  const status = useSyncStatus();
  const linked = Boolean(status.data?.linked);
  const conflicts = useConflicts(linked || Boolean(status.data?.openConflicts));
  const projects = useQuery({ queryKey: ["projects"], queryFn: API.projects, enabled: linked });
  const [form, setForm] = useState({ url: "", deviceName: "", token: "", passphrase: "" });
  const [showToken, setShowToken] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((value) => ({ ...value, ...patch }));

  const act = async (name: string, work: () => Promise<unknown>) => {
    setBusy(name); setError("");
    try { await work(); return true; } catch (failure) { setError(failure instanceof ApiError ? failure.full : String(failure)); return false; } finally {
      setBusy("");
      await client.invalidateQueries({ queryKey: ["sync"] });
    }
  };
  const save = (name: string, changes: Parameters<typeof API.syncConfigure>[0]) => act(name, async () => { client.setQueryData(STATUS_KEY, await API.syncConfigure(changes)); });

  const header = <div className="flex flex-wrap items-start justify-between gap-2">
    <p className="flex items-center gap-2 text-sm font-semibold"><CloudUpload className="size-4 text-slate-400"/>{t.title}</p>
    <Link href="?vista=guia&guia=sync" size="1" weight="medium" underline="always" className="inline-flex items-center gap-1"><BookOpen className="size-3"/>{t.guide}</Link>
  </div>;
  const alert = (text: string) => <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{text}</Callout.Text></Callout.Root>;

  if (!status.data) return <Card className="p-5">{header}{status.error ? alert(status.error instanceof ApiError ? status.error.full : String(status.error)) : <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Spinner size="1"/></p>}</Card>;
  const sync = status.data;
  const unlink = () => act("unlink", async () => { await API.syncUnlink(); setResult(null); setChosen(null); });

  if (!sync.linked) return <Card className="p-5">
    {header}
    <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">{t.intro}</p>
    {sync.pending ? <div className="mt-4"><PendingLink status={sync} busy={busy === "unlink"} onCancel={() => { void unlink(); }}/></div> : <form className="mt-4 grid max-w-xl gap-3" onSubmit={(event) => {
      event.preventDefault();
      void act("link", async () => { client.setQueryData(STATUS_KEY, await API.syncLink({ url: form.url.trim(), token: showToken && form.token.trim() ? form.token.trim() : undefined, deviceName: form.deviceName.trim() || undefined })); set({ token: "" }); });
    }}>
      <label className="text-[11px] font-medium text-slate-600">{t.url}<TextField.Root size="2" type="url" required value={form.url} onChange={(event) => set({ url: event.target.value })} placeholder="https://eq.example.com" className="mt-1"/><span className="mt-1 block font-normal text-slate-500">{t.urlHint}</span></label>
      <label className="text-[11px] font-medium text-slate-600">{t.device}<TextField.Root size="2" value={form.deviceName} onChange={(event) => set({ deviceName: event.target.value })} placeholder={sync.deviceName} className="mt-1"/><span className="mt-1 block font-normal text-slate-500">{t.deviceHint}</span></label>
      <div>
        <Button type="button" size="1" variant="ghost" color="gray" onClick={() => setShowToken(!showToken)} aria-expanded={showToken}><ChevronDown className={cn("size-3.5 transition-transform", !showToken && "-rotate-90")}/>{t.useToken}</Button>
        {showToken && <label className="mt-2 block text-[11px] font-medium text-slate-600">{t.token}<TextField.Root size="2" type="password" autoComplete="off" value={form.token} onChange={(event) => set({ token: event.target.value })} placeholder="eqt_…" className="mt-1 font-mono"/><span className="mt-1 block font-normal text-slate-500">{t.tokenHint}</span></label>}
      </div>
      <Flex gap="3" align="center" wrap="wrap">
        <Button type="submit" size="2" loading={busy === "link"}>{t.link}</Button>
        <Button asChild size="2" variant="soft"><a href={signUpUrl(form.url)} target="_blank" rel="noreferrer" aria-disabled={!signUpUrl(form.url)} onClick={(event) => { if (!signUpUrl(form.url)) event.preventDefault(); }}><UserPlus className="size-3.5"/>{t.account}<ExternalLink className="size-3"/></a></Button>
      </Flex>
      <p className="-mt-1 text-[11px] leading-5 text-slate-500">{t.accountHint}</p>
    </form>}
    {sync.lastError && !sync.pending && alert(sync.lastError)}
    {error && alert(error)}
    {!!conflicts.data?.length && <div className="mt-5"><p className="text-xs font-semibold">{t.conflicts(conflicts.data.length)}</p><div className="mt-2"><ConflictsList conflicts={conflicts.data} mode="local"/></div></div>}
  </Card>;

  const shown = result ?? sync.lastResult;
  const running = busy === "run" || sync.syncing;
  const selection = chosen ?? sync.projects;
  const selectionChanged = JSON.stringify(selection ?? null) !== JSON.stringify(sync.projects ?? null);
  return <Card className="p-5">
    {header}
    <p className="mt-1 text-xs text-slate-600">{t.linkedTo} <span className="font-semibold text-slate-900">{sync.workspace?.name || "—"}</span> · <span className="font-mono text-[11px]">{sync.url}</span> · {t.as} <span className="font-medium">{sync.deviceName}</span></p>
    <p className="mt-1 text-[11px] text-slate-500">{t.lastSync}: {sync.lastSyncAt ? formatDate(Date.parse(sync.lastSyncAt), locale) : t.never}{shown && <> · {t.summary(shown)}</>}</p>
    <p className="mt-0.5 text-[11px] text-slate-500">{sync.autoSyncSeconds > 0 ? t.auto(sync.autoSyncSeconds) : t.onDemand}{sync.pendingChanges > 0 && <> · <span className="font-medium text-amber-700">{t.pendingChanges(sync.pendingChanges)}</span></>}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" size="2" disabled={running} onClick={() => { void act("run", async () => setResult(await API.syncRun())); }}><RefreshCw className={cn("size-3.5", running && "animate-spin")}/>{running ? t.syncing : t.syncNow}</Button>
    </div>
    {sync.lastError && alert(sync.lastError)}
    {error && alert(error)}
    {!!result?.rejected.length && <Callout.Root size="1" color="amber" className="mt-3"><Callout.Icon><TriangleAlert className="size-4"/></Callout.Icon><div className="text-[11px]"><p className="font-medium">{t.rejected}</p><ul className="mt-1 grid gap-0.5">{result.rejected.map((item) => <li key={`${item.type}:${item.id}`}><span className="font-mono">{item.type} {item.id}</span>: {item.error}</li>)}</ul></div></Callout.Root>}

    {!!conflicts.data?.length && <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="text-xs font-semibold">{t.conflicts(conflicts.data.length)}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{t.conflictsHint}</p>
      <div className="mt-3"><ConflictsList conflicts={conflicts.data} mode="local"/></div>
    </div>}

    <div className="mt-5 grid gap-5 border-t border-slate-100 pt-4 lg:grid-cols-2">
      <div>
        <p className="text-xs font-semibold">{t.what}</p>
        <div className="mt-2"><Toggle checked={sync.includeRuns} disabled={busy === "runs"} onChange={(includeRuns) => { void save("runs", { includeRuns }); }} label={t.runs} hint={t.runsHint}/></div>
        <p className="mt-3 text-[11px] font-medium text-slate-600">{t.projects}</p>
        <RadioGroup.Root size="1" name="sync-projects" value={selection === null ? "all" : "some"} onValueChange={(value) => setChosen(value === "all" ? null : selection ?? [])} className="mt-1 flex flex-row gap-4">
          <Text as="label" size="1"><Flex gap="2" align="center"><RadioGroup.Item value="all"/>{t.allProjects}</Flex></Text>
          <Text as="label" size="1"><Flex gap="2" align="center"><RadioGroup.Item value="some"/>{t.someProjects}</Flex></Text>
        </RadioGroup.Root>
        {selection !== null && (projects.data?.length ? <ul className="mt-2 grid max-h-48 gap-1 overflow-auto rounded-lg border border-slate-200 p-2">{projects.data.map((project) => <li key={project.id}><Text as="label" size="1"><Flex gap="2" align="center"><Checkbox size="1" checked={selection.includes(project.id)} onCheckedChange={(checked) => setChosen(checked === true ? [...selection, project.id] : selection.filter((id) => id !== project.id))}/>{project.name} <span className="font-mono text-[10px] text-slate-400">{project.slug}</span></Flex></Text></li>)}</ul> : <p className="mt-2 text-[11px] text-slate-500">{t.noProjects}</p>)}
        {selectionChanged && <Button type="button" size="1" variant="surface" color="gray" loading={busy === "projects"} disabled={selection !== null && !selection.length} onClick={() => { void save("projects", { projects: selection }).then((ok) => { if (ok) setChosen(null); }); }} className="mt-2">{t.saveProjects}</Button>}
      </div>
      <div>
        <p className="flex items-center gap-2 text-xs font-semibold"><KeyRound className="size-3.5 text-slate-400"/>{t.secrets}</p>
        <p className={cn("mt-2 text-xs font-medium", sync.secrets ? "text-emerald-700" : "text-slate-700")}>{sync.secrets ? t.secretsOn : t.secretsOff}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">{t.secretsHint}</p>
        {sync.secrets
          ? <Button type="button" size="1" variant="surface" color="gray" disabled={busy === "secrets"} onClick={() => { void save("secrets", { passphrase: null }); }} className="mt-3">{t.disable}</Button>
          : <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void save("secrets", { passphrase: form.passphrase }).then((ok) => { if (ok) set({ passphrase: "" }); }); }}>
            <TextField.Root size="2" type="password" autoComplete="new-password" aria-label={t.passphrase} placeholder={t.passphrase} minLength={12} required value={form.passphrase} onChange={(event) => set({ passphrase: event.target.value })} className="min-w-0 flex-1"/>
            <Button type="submit" size="2" loading={busy === "secrets"} disabled={form.passphrase.length < 12}>{t.enable}</Button>
          </form>}
      </div>
    </div>

    <div className="mt-5 border-t border-slate-100 pt-4">
      <AlertDialog.Root>
        <AlertDialog.Trigger><Button type="button" size="1" variant="ghost" color="red" disabled={busy === "unlink"}><Unlink className="size-3.5"/>{t.unlink}</Button></AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title size="3">{t.unlink}</AlertDialog.Title>
          <AlertDialog.Description size="2">{t.unlinkConfirm}</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray">{t.cancel}</Button></AlertDialog.Cancel>
            <AlertDialog.Action><Button variant="solid" color="red" onClick={() => { void unlink(); }}>{t.unlink}</Button></AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  </Card>;
}
