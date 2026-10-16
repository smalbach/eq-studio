import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout, Checkbox, IconButton, SegmentedControl, Select, Switch, TextField } from "@radix-ui/themes";
import { Bell, CalendarClock, CircleAlert, CircleCheck, Play, Plus, Send, Trash2, X } from "lucide-react";
import type { Environment } from "@/components/environment/use-environment";
import { API, ApiError, type NotificationKind, type NotificationTargetView, type ScheduleView } from "@/lib/api";
import { useProject } from "@/lib/project-store";
import { defineMessages, useIntlLocale, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    schedules: "Programaciones", schedulesHint: "Corridas que el API inicia solo, con la hora en UTC. Siguen corriendo con el navegador cerrado.", notifications: "Notificaciones", notificationsHint: "A dónde se avisa cuando termina una corrida de este proyecto.", close: "Cerrar automatización",
    newSchedule: "Nueva programación", newTarget: "Nuevo destino", kind: "Tipo", name: "Nombre", environment: "Entorno", frequency: "Frecuencia", cron: "Expresión cron (UTC)", create: "Crear", cancel: "Cancelar", remove: "Eliminar", runNow: "Correr ahora", started: "Corrida iniciada.",
    presets: { "@hourly": "Cada hora", "@daily": "Diaria (06:00 UTC)", "@weekly": "Semanal (lunes 06:00 UTC)", custom: "Personalizada (cron)" } as Record<string, string>,
    functional: "Funcional", load: "Carga", readOnly: "Solo lectura (GET)", readOnlyHint: "Las corridas con escrituras y las pruebas de carga programadas necesitan el rol admin.", loadType: "Tipo", rps: "RPS", duration: "Duración (s)",
    loadTypes: { load: "Carga", stress: "Estrés", spike: "Pico", soak: "Resistencia" } as Record<string, string>,
    next: "próxima", last: "última", paused: "pausada", never: "aún no corrió", enabled: "Activa",
    noSchedules: "Sin programaciones: una corrida diaria de solo lectura es un buen comienzo.", noTargets: "Sin destinos: nadie se entera de una corrida que falla de noche.",
    kinds: { webhook: "Webhook (JSON)", slack: "Slack", email: "Email" } as Record<NotificationKind, string>,
    url: "URL del webhook", urlKeep: "(vacío = conservar la actual)", urlSecret: "Se guarda cifrada; solo se muestra el host y el final.", signing: "Secreto de firma HMAC (opcional, 16+ caracteres)", recipients: "Destinatarios (separados por coma)",
    notifyOn: { change: "Solo si cambia el veredicto", always: "Siempre" } as Record<string, string>, signed: "firmado",
    emailOff: "El email necesita SMTP configurado en el servidor (EQ_SMTP_URL).", test: "Enviar prueba", testOk: "Mensaje de prueba entregado.", testFailed: (error: string) => `La prueba falló: ${error}`, lastOk: "último envío ok", lastFailed: "último envío falló",
    statuses: { queued: "en cola", running: "en curso", cancelling: "cancelando", passed: "pasó", failed: "falló", cancelled: "cancelada", interrupted: "interrumpida", error: "error" } as Record<string, string>,
  },
  en: {
    schedules: "Schedules", schedulesHint: "Runs the API starts on its own, times in UTC. They keep running with the browser closed.", notifications: "Notifications", notificationsHint: "Where to announce that a run of this project finished.", close: "Close automation",
    newSchedule: "New schedule", newTarget: "New target", kind: "Type", name: "Name", environment: "Environment", frequency: "Frequency", cron: "Cron expression (UTC)", create: "Create", cancel: "Cancel", remove: "Delete", runNow: "Run now", started: "Run started.",
    presets: { "@hourly": "Hourly", "@daily": "Daily (06:00 UTC)", "@weekly": "Weekly (Monday 06:00 UTC)", custom: "Custom (cron)" } as Record<string, string>,
    functional: "Functional", load: "Load", readOnly: "Read only (GET)", readOnlyHint: "Scheduled runs with writes and scheduled load tests need the admin role.", loadType: "Type", rps: "RPS", duration: "Duration (s)",
    loadTypes: { load: "Load", stress: "Stress", spike: "Spike", soak: "Soak" } as Record<string, string>,
    next: "next", last: "last", paused: "paused", never: "not run yet", enabled: "Enabled",
    noSchedules: "No schedules yet: a daily read-only run is a good start.", noTargets: "No targets yet: nobody hears about a run that fails at night.",
    kinds: { webhook: "Webhook (JSON)", slack: "Slack", email: "Email" } as Record<NotificationKind, string>,
    url: "Webhook URL", urlKeep: "(empty = keep the current one)", urlSecret: "Stored encrypted; only its host and ending are shown.", signing: "HMAC signing secret (optional, 16+ characters)", recipients: "Recipients (comma-separated)",
    notifyOn: { change: "Only when the verdict changes", always: "Always" } as Record<string, string>, signed: "signed",
    emailOff: "Email needs SMTP configured on the server (EQ_SMTP_URL).", test: "Send test", testOk: "Test message delivered.", testFailed: (error: string) => `The test failed: ${error}`, lastOk: "last delivery ok", lastFailed: "last delivery failed",
    statuses: { queued: "queued", running: "running", cancelling: "cancelling", passed: "passed", failed: "failed", cancelled: "cancelled", interrupted: "interrupted", error: "error" } as Record<string, string>,
  },
});

const KEYS = { schedules: (id: string) => ["schedules", id] as const, notifications: (id: string) => ["notifications", id] as const };
const field = "text-[11px] text-slate-500";
const STATUS_COLOR: Record<string, "green" | "red" | "gray" | "blue"> = { passed: "green", failed: "red", error: "red", running: "blue", queued: "blue" };

const message = (failure: unknown) => failure instanceof ApiError ? failure.full : failure instanceof Error ? failure.message : String(failure);

/** Errors and confirmations of one card, below it. */
function useNotice() {
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const node = notice && <Callout.Root size="1" color={notice.error ? "red" : "green"} role={notice.error ? "alert" : "status"} className="mt-2"><Callout.Icon>{notice.error ? <CircleAlert className="size-4"/> : <CircleCheck className="size-4"/>}</Callout.Icon><Callout.Text className="whitespace-pre-line">{notice.text}</Callout.Text></Callout.Root>;
  return { node, ok: (text: string) => setNotice({ text, error: false }), fail: (failure: unknown) => setNotice({ text: message(failure), error: true }), clear: () => setNotice(null) };
}

function NewScheduleForm({ env, onSave, onDone }: { env: Environment; onSave: (input: Parameters<typeof API.createSchedule>[1]) => Promise<boolean>; onDone: () => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState(env.environmentId);
  const [preset, setPreset] = useState("@daily");
  const [cron, setCron] = useState("0 6 * * *");
  const [kind, setKind] = useState<"functional" | "load">("functional");
  const [readOnly, setReadOnly] = useState(true);
  const [loadType, setLoadType] = useState("load");
  const [rps, setRps] = useState("10");
  const [duration, setDuration] = useState("30");
  const plan = kind === "functional" ? { readOnly, locale } : { type: loadType, baseRps: Number(rps), durationS: Number(duration), locale };
  return <form className="mt-3 grid gap-2 rounded-[var(--radius-4)] border border-dashed border-slate-300 p-3 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); if (await onSave({ name, environment, cron: preset === "custom" ? cron : preset, kind, plan })) onDone(); }}>
    <label className={field}>{t.name}<TextField.Root size="2" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightly" className="mt-1"/></label>
    <label className={field}>{t.environment}<Select.Root size="2" value={environment} onValueChange={setEnvironment}><Select.Trigger className="mt-1 w-full" aria-label={t.environment}/><Select.Content>{env.environments.map((item) => <Select.Item key={item.environmentId} value={item.environmentId}>{item.name}</Select.Item>)}</Select.Content></Select.Root></label>
    <label className={field}>{t.frequency}<Select.Root size="2" value={preset} onValueChange={setPreset}><Select.Trigger className="mt-1 w-full" aria-label={t.frequency}/><Select.Content>{Object.entries(t.presets).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content></Select.Root></label>
    {preset === "custom" ? <label className={field}>{t.cron}<TextField.Root size="2" required value={cron} onChange={(event) => setCron(event.target.value)} placeholder="*/30 8-18 * * 1-5" className="mt-1 font-mono"/></label> : <span/>}
    <div className="sm:col-span-2"><SegmentedControl.Root size="1" value={kind} onValueChange={(value) => setKind(value as "functional" | "load")}><SegmentedControl.Item value="functional">{t.functional}</SegmentedControl.Item><SegmentedControl.Item value="load">{t.load}</SegmentedControl.Item></SegmentedControl.Root></div>
    {kind === "functional" ? <label htmlFor="schedule-read-only" className="flex items-center gap-2 text-[11px] text-slate-600 sm:col-span-2"><Checkbox id="schedule-read-only" size="1" checked={readOnly} onCheckedChange={(checked) => setReadOnly(checked === true)}/>{t.readOnly}</label> : <div className="grid grid-cols-3 gap-2 sm:col-span-2">
      <label className={field}>{t.loadType}<Select.Root size="2" value={loadType} onValueChange={setLoadType}><Select.Trigger className="mt-1 w-full" aria-label={t.loadType}/><Select.Content>{Object.entries(t.loadTypes).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content></Select.Root></label>
      <label className={field}>{t.rps}<TextField.Root size="2" type="number" min={1} max={500} required value={rps} onChange={(event) => setRps(event.target.value)} className="mt-1 font-mono"/></label>
      <label className={field}>{t.duration}<TextField.Root size="2" type="number" min={1} max={1800} required value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 font-mono"/></label>
    </div>}
    <p className="text-[10px] leading-4 text-slate-400 sm:col-span-2">{t.readOnlyHint}</p>
    <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="2" disabled={!environment}>{t.create}</Button><Button type="button" size="2" variant="surface" color="gray" onClick={onDone}>{t.cancel}</Button></div>
  </form>;
}

function ScheduleItem({ schedule, env, onChange, onRun, onDelete }: { schedule: ScheduleView; env: Environment; onChange: (enabled: boolean) => void; onRun: () => void; onDelete: () => void }) {
  const t = useMessages(MESSAGES);
  const intl = useIntlLocale();
  const environment = env.environments.find((item) => item.environmentId === schedule.environmentId);
  const when = (iso: string) => new Date(iso).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" });
  const preset = t.presets[schedule.cron];
  const what = schedule.kind === "functional" ? `${t.functional}${schedule.plan.readOnly ? ` · ${t.readOnly}` : ""}` : `${t.load} · ${t.loadTypes[String(schedule.plan.type)] ?? schedule.plan.type} · ${schedule.plan.baseRps} ${t.rps}`;
  return <li className="rounded-lg border border-slate-200 bg-panel p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="min-w-0 text-xs font-semibold text-slate-700"><span className="truncate">{schedule.name}</span> <span className="font-normal text-slate-400">· {environment?.name ?? "—"} · {preset ?? <span className="font-mono">{schedule.cron}</span>}</span></p>
      <div className="flex items-center gap-2">
        <Switch size="1" checked={schedule.enabled} onCheckedChange={onChange} aria-label={`${t.enabled}: ${schedule.name}`}/>
        <Button type="button" size="1" variant="surface" color="gray" onClick={onRun}><Play className="size-3"/>{t.runNow}</Button>
        <IconButton type="button" size="1" variant="ghost" color="red" onClick={onDelete} aria-label={`${t.remove} ${schedule.name}`}><Trash2 className="size-3"/></IconButton>
      </div>
    </div>
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
      <span>{what}</span>
      <span>{schedule.enabled && schedule.nextRunAt ? `${t.next}: ${when(schedule.nextRunAt)}` : t.paused}</span>
      <span className="flex items-center gap-1">{t.last}: {schedule.lastRunAt ? when(schedule.lastRunAt) : t.never}{schedule.lastRunStatus && <Badge size="1" color={STATUS_COLOR[schedule.lastRunStatus] ?? "gray"}>{t.statuses[schedule.lastRunStatus] ?? schedule.lastRunStatus}</Badge>}</span>
    </p>
    {schedule.lastError && <p className="mt-1 text-[10px] leading-4 text-amber-700">{schedule.lastError}</p>}
  </li>;
}

function SchedulesCard({ env }: { env: Environment }) {
  const t = useMessages(MESSAGES);
  const project = useProject();
  const client = useQueryClient();
  const notice = useNotice();
  const [adding, setAdding] = useState(false);
  const query = useQuery({ queryKey: KEYS.schedules(project.id), queryFn: () => API.schedules(project.id), enabled: Boolean(project.id), refetchInterval: 30_000 });
  const reload = () => client.invalidateQueries({ queryKey: KEYS.schedules(project.id) });
  const act = async (work: () => Promise<unknown>, done?: string) => {
    try { await work(); if (done) notice.ok(done); else notice.clear(); await reload(); return true; } catch (failure) { notice.fail(failure); return false; }
  };
  const schedules = query.data ?? [];
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-700"><CalendarClock className="size-3.5 text-slate-400"/>{t.schedules}</p>
      <Button type="button" size="1" variant="surface" color="gray" disabled={!env.environments.length} onClick={() => setAdding(true)}><Plus className="size-3"/>{t.newSchedule}</Button>
    </div>
    <p className="text-[10px] text-slate-400">{t.schedulesHint}</p>
    {adding && <NewScheduleForm env={env} onSave={(input) => act(() => API.createSchedule(project.id, input))} onDone={() => setAdding(false)}/>}
    {!schedules.length && !adding && <p className="mt-2 text-[11px] text-slate-500">{t.noSchedules}</p>}
    <ul className="mt-2 grid gap-2">{schedules.map((schedule) => <ScheduleItem key={schedule.id} schedule={schedule} env={env}
      onChange={(enabled) => { void act(() => API.updateSchedule(project.id, schedule.id, { enabled })); }}
      onRun={() => { void act(async () => { const result = await API.runSchedule(project.id, schedule.id); if (!result.id) throw new Error(result.error ?? "—"); }, t.started); }}
      onDelete={() => { void act(() => API.deleteSchedule(project.id, schedule.id)); }}/>)}</ul>
    {notice.node}
  </section>;
}

function NewTargetForm({ emailAvailable, onSave, onDone }: { emailAvailable: boolean; onSave: (input: Parameters<typeof API.createNotification>[1]) => Promise<boolean>; onDone: () => void }) {
  const t = useMessages(MESSAGES);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<NotificationKind>("slack");
  const [notifyOn, setNotifyOn] = useState<"change" | "always">("change");
  const [url, setUrl] = useState("");
  const [signing, setSigning] = useState("");
  const [recipients, setRecipients] = useState("");
  const input = kind === "email" ? { recipients: recipients.split(",").map((item) => item.trim()).filter(Boolean) } : { url: url.trim(), ...(kind === "webhook" && signing ? { signingSecret: signing } : {}) };
  return <form className="mt-3 grid gap-2 rounded-[var(--radius-4)] border border-dashed border-slate-300 p-3 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); if (await onSave({ name, kind, notifyOn, ...input })) onDone(); }}>
    <label className={field}>{t.name}<TextField.Root size="2" required value={name} onChange={(event) => setName(event.target.value)} placeholder="#api-alerts" className="mt-1"/></label>
    <label className={field}>{t.kind}<Select.Root size="2" value={kind} onValueChange={(value) => setKind(value as NotificationKind)}><Select.Trigger className="mt-1 w-full" aria-label={t.kind}/><Select.Content>{(Object.keys(t.kinds) as NotificationKind[]).map((value) => <Select.Item key={value} value={value} disabled={value === "email" && !emailAvailable}>{t.kinds[value]}</Select.Item>)}</Select.Content></Select.Root></label>
    {kind === "email"
      ? <label className={`${field} sm:col-span-2`}>{t.recipients}<TextField.Root size="2" required value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="team@example.com, oncall@example.com" className="mt-1 font-mono"/></label>
      : <label className={`${field} sm:col-span-2`}>{t.url}<TextField.Root size="2" required type="url" autoComplete="off" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={kind === "slack" ? "https://hooks.slack.com/services/…" : "https://ci.example.com/hooks/eq"} className="mt-1 font-mono"/><span className="mt-0.5 block text-[10px] text-slate-400">{t.urlSecret}</span></label>}
    {kind === "webhook" && <label className={`${field} sm:col-span-2`}>{t.signing}<TextField.Root size="2" type="password" autoComplete="off" minLength={16} value={signing} onChange={(event) => setSigning(event.target.value)} className="mt-1 font-mono"/></label>}
    <div className="sm:col-span-2"><SegmentedControl.Root size="1" value={notifyOn} onValueChange={(value) => setNotifyOn(value as "change" | "always")}>{Object.entries(t.notifyOn).map(([value, label]) => <SegmentedControl.Item key={value} value={value}>{label}</SegmentedControl.Item>)}</SegmentedControl.Root></div>
    {!emailAvailable && <p className="text-[10px] leading-4 text-slate-400 sm:col-span-2">{t.emailOff}</p>}
    <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="2">{t.create}</Button><Button type="button" size="2" variant="surface" color="gray" onClick={onDone}>{t.cancel}</Button></div>
  </form>;
}

function TargetItem({ target, onChange, onTest, onDelete }: { target: NotificationTargetView; onChange: (changes: { enabled?: boolean; notifyOn?: "always" | "change" }) => void; onTest: () => void; onDelete: () => void }) {
  const t = useMessages(MESSAGES);
  const where = target.kind === "email" ? (target.recipients ?? []).join(", ") : target.urlHint;
  return <li className="rounded-lg border border-slate-200 bg-panel p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="min-w-0 text-xs font-semibold text-slate-700">{target.name} <span className="font-normal text-slate-400">· {t.kinds[target.kind]}{target.signed ? ` · ${t.signed}` : ""}</span></p>
      <div className="flex items-center gap-2">
        <Switch size="1" checked={target.enabled} onCheckedChange={(enabled) => onChange({ enabled })} aria-label={`${t.enabled}: ${target.name}`}/>
        <Button type="button" size="1" variant="surface" color="gray" onClick={onTest}><Send className="size-3"/>{t.test}</Button>
        <IconButton type="button" size="1" variant="ghost" color="red" onClick={onDelete} aria-label={`${t.remove} ${target.name}`}><Trash2 className="size-3"/></IconButton>
      </div>
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
      <span className="font-mono">{where}</span>
      <Select.Root size="1" value={target.notifyOn} onValueChange={(value) => onChange({ notifyOn: value as "always" | "change" })}><Select.Trigger variant="ghost" aria-label={`${target.name}: ${t.notifyOn[target.notifyOn]}`}/><Select.Content>{Object.entries(t.notifyOn).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content></Select.Root>
      {target.lastStatus && <Badge size="1" color={target.lastStatus === "ok" ? "green" : "red"}>{target.lastStatus === "ok" ? t.lastOk : t.lastFailed}</Badge>}
    </div>
    {target.lastStatus === "failed" && target.lastError && <p className="mt-1 text-[10px] leading-4 text-rose-600">{target.lastError}</p>}
  </li>;
}

function NotificationsCard() {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const project = useProject();
  const client = useQueryClient();
  const notice = useNotice();
  const [adding, setAdding] = useState(false);
  const query = useQuery({ queryKey: KEYS.notifications(project.id), queryFn: () => API.notifications(project.id), enabled: Boolean(project.id) });
  const reload = () => client.invalidateQueries({ queryKey: KEYS.notifications(project.id) });
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); notice.clear(); await reload(); return true; } catch (failure) { notice.fail(failure); return false; }
  };
  const test = async (target: NotificationTargetView) => {
    try { const result = await API.testNotification(project.id, target.id, locale); if (result.ok) notice.ok(t.testOk); else notice.fail(new Error(t.testFailed(result.error ?? "—"))); } catch (failure) { notice.fail(failure); }
    await reload();
  };
  const targets = query.data?.targets ?? [];
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Bell className="size-3.5 text-slate-400"/>{t.notifications}</p>
      <Button type="button" size="1" variant="surface" color="gray" onClick={() => setAdding(true)}><Plus className="size-3"/>{t.newTarget}</Button>
    </div>
    <p className="text-[10px] text-slate-400">{t.notificationsHint}</p>
    {adding && <NewTargetForm emailAvailable={Boolean(query.data?.emailAvailable)} onSave={(input) => act(() => API.createNotification(project.id, input))} onDone={() => setAdding(false)}/>}
    {!targets.length && !adding && <p className="mt-2 text-[11px] text-slate-500">{t.noTargets}</p>}
    <ul className="mt-2 grid gap-2">{targets.map((target) => <TargetItem key={target.id} target={target}
      onChange={(changes) => { void act(() => API.updateNotification(project.id, target.id, changes)); }}
      onTest={() => { void test(target); }}
      onDelete={() => { void act(() => API.deleteNotification(project.id, target.id)); }}/>)}</ul>
    {notice.node}
  </section>;
}

/**
 * The project's automation: runs the API starts on a schedule, and where it announces finished
 * runs. Both live in the API, so they keep working with every browser closed.
 */
export function AutomationPanel({ env, onClose }: { env: Environment; onClose?: () => void }) {
  const t = useMessages(MESSAGES);
  return <div>
    {onClose && <div className="mb-2 flex justify-end"><IconButton type="button" size="2" variant="surface" color="gray" onClick={onClose} aria-label={t.close}><X className="size-4"/></IconButton></div>}
    <div className="grid gap-3 lg:grid-cols-2"><SchedulesCard env={env}/><NotificationsCard/></div>
  </div>;
}
