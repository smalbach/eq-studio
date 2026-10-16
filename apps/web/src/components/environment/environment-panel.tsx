import { useState } from "react";
import { Button, Callout, Checkbox, IconButton, TextField } from "@radix-ui/themes";
import { CircleAlert, Globe2, Plus, Trash2, Upload, X } from "lucide-react";
import { CredentialsCard } from "@/components/functional/workbench/credentials-card";
import { settingsOf, type Environment } from "@/components/environment/use-environment";
import { isLoopback } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    environment: "Entorno", importPostman: "Importar entorno de Postman", close: "Cerrar configuración de entorno",
    baseUrl: "URL base de la API", specUrl: "Documento OpenAPI (ruta bajo la URL base o URL absoluta)",
    seededTag: "semilla", sharedTag: "compartido", writesOff: "solo lectura",
    seeded: "Entorno con la semilla del proyecto", seededHint: "Los ids de la semilla existen aquí. Si no, se detectan antes de cada corrida.",
    writes: "Permitir escrituras (POST, PUT, PATCH, DELETE)", writesHint: "Apagado, el motor no envía los casos de escritura y los marca como bloqueados.",
    latency: "Exigir presupuestos de latencia", latencyHint: "Apagado, la latencia se muestra pero no decide el caso: útil a través de VPN o gateway.",
    auth: "La API exige autenticación (casos 401/403)", authHint: "Contra una API que deja pasar a todos, los casos 401/403 fallarían por un motivo ajeno al endpoint.",
    newEnvironment: "Nuevo entorno", name: "Nombre", create: "Crear", cancel: "Cancelar", remove: "Eliminar este entorno",
    none: "Este proyecto aún no tiene entornos: crea uno con la URL base de la API.",
  },
  en: {
    environment: "Environment", importPostman: "Import Postman environment", close: "Close environment settings",
    baseUrl: "API base URL", specUrl: "OpenAPI document (path under the base URL or absolute URL)",
    seededTag: "seed", sharedTag: "shared", writesOff: "read only",
    seeded: "Environment holds the project's seed", seededHint: "The seed's ids exist here. If not, they are detected before each run.",
    writes: "Allow writes (POST, PUT, PATCH, DELETE)", writesHint: "Off, the engine does not send write cases and marks them as blocked.",
    latency: "Enforce latency budgets", latencyHint: "Off, latency is shown but does not decide the case: useful across a VPN or gateway.",
    auth: "The API enforces authentication (401/403 cases)", authHint: "Against an API that lets everyone in, the 401/403 cases would fail for a reason unrelated to the endpoint.",
    newEnvironment: "New environment", name: "Name", create: "Create", cancel: "Cancel", remove: "Delete this environment",
    none: "This project has no environments yet: create one with the API's base URL.",
  },
});

const chip = (active: boolean) => cn("rounded-[var(--radius-4)] border px-3 py-2 text-left text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-8 disabled:opacity-50", active ? "border-accent-8 bg-accent-3 ring-2 ring-accent-5" : "border-slate-200 hover:bg-slate-50");

/** A text field saved when it loses focus, not on every keystroke. */
function SavedField({ id, label, value, placeholder, disabled, onSave }: { id: string; label: string; value: string; placeholder?: string; disabled: boolean; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label htmlFor={id} className="mt-2 block text-[11px] text-slate-500">{label}<TextField.Root size="2" id={id} value={draft ?? value} placeholder={placeholder} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== null && draft !== value) onSave(draft); setDraft(null); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} className="mt-1 font-mono"/></label>;
}

function NewEnvironmentForm({ env, onDone }: { env: Environment; onDone: () => void }) {
  const t = useMessages(MESSAGES);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  return <form className="mt-3 grid gap-2 rounded-[var(--radius-4)] border border-dashed border-slate-300 p-3 sm:grid-cols-[1fr_2fr_auto]" onSubmit={async (event) => { event.preventDefault(); if (await env.createEnvironment({ name, baseUrl: baseUrl.trim() })) onDone(); }}>
    <label className="text-[11px] text-slate-500">{t.name}<TextField.Root size="2" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Staging" className="mt-1 font-mono"/></label>
    <label className="text-[11px] text-slate-500">{t.baseUrl}<TextField.Root size="2" required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" className="mt-1 font-mono"/></label>
    <div className="flex items-end gap-2"><Button type="submit" size="2">{t.create}</Button><Button type="button" size="2" variant="surface" color="gray" onClick={onDone}>{t.cancel}</Button></div>
  </form>;
}

/** What the environment allows, each switch with the reason it exists. Saved as soon as it changes. */
function EnvironmentSwitches({ env, busy }: { env: Environment; busy: boolean }) {
  const t = useMessages(MESSAGES);
  const rows: [boolean, string, string, string][] = [
    [env.seeded, "seeded", t.seeded, t.seededHint],
    [env.writesAllowed, "writesAllowed", t.writes, t.writesHint],
    [env.enforceLatency, "enforceLatency", t.latency, t.latencyHint],
    [env.authEnabled, "authEnabled", t.auth, t.authHint],
  ];
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">{rows.map(([value, key, label, hint]) => <label key={key} htmlFor={`environment-${key}`} aria-label={label} className={cn("flex cursor-pointer items-start gap-2 rounded-[var(--radius-4)] border border-slate-200 p-2.5 text-[11px] text-slate-600", busy && "pointer-events-none opacity-60")}>
    <Checkbox id={`environment-${key}`} size="1" checked={value} disabled={busy} onCheckedChange={(checked) => { void env.saveEnvironment({ [key]: checked === true }); }} className="mt-0.5"/>
    <span><span className="block font-medium text-slate-700">{label}</span><span className="block text-[10px] leading-4 text-slate-400">{hint}</span></span>
  </label>)}</div>;
}

/**
 * Where runs go: the project's environments as the API keeps them, what each one allows, and
 * the credentials it presents. Everything here is saved in the API, so another browser, the CLI
 * and the scheduled runs see the same environments.
 */
export function EnvironmentPanel({ env, busy, onClose }: { env: Environment; busy: boolean; onClose?: () => void }) {
  const t = useMessages(MESSAGES);
  const [adding, setAdding] = useState(false);
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><Globe2 className="size-4 text-slate-400"/>{t.environment}<span className="font-mono text-[11px] font-normal text-slate-500">{env.label}</span></p>
      <div className="flex gap-2">
        <Button type="button" size="2" variant="surface" color="gray" disabled={busy} onClick={() => setAdding(true)}><Plus className="size-3.5"/>{t.newEnvironment}</Button>
        <Button asChild size="2" variant="surface" color="gray" className={cn("cursor-pointer", busy && "pointer-events-none opacity-50")}><label htmlFor="postman-environment-file">
          <Upload className="size-3.5"/>{t.importPostman}
          <input id="postman-environment-file" type="file" accept=".json,application/json" multiple disabled={busy} onChange={(event) => { void env.importFiles(event.target.files); event.target.value = ""; }} className="sr-only"/>
        </label></Button>
        {onClose && <IconButton type="button" size="2" variant="surface" color="gray" onClick={onClose} aria-label={t.close}><X className="size-4"/></IconButton>}
      </div>
    </div>
    {adding && <NewEnvironmentForm env={env} onDone={() => setAdding(false)}/>}
    {!env.environments.length && !adding && <p className="mt-3 text-[11px] text-slate-500">{t.none}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {env.environments.map((item) => { const settings = settingsOf(item); return <button key={item.environmentId} type="button" aria-pressed={item.environmentId === env.environmentId} onClick={() => env.selectEnvironment(item)} disabled={busy} className={chip(item.environmentId === env.environmentId)}>
        <span className="block font-medium text-slate-700">{item.name}</span>
        <span className="block font-mono text-[10px] text-slate-500">{item.baseUrl}</span>
        <span className="block text-[10px] text-slate-400">{settings.seeded ? t.seededTag : t.sharedTag}{settings.writesAllowed ? "" : ` · ${t.writesOff}`}{isLoopback(item.baseUrl) ? " · localhost" : ""}</span>
      </button>; })}
    </div>
    {env.active && <>
      <SavedField id="environment-base-url" label={t.baseUrl} value={env.baseUrl} disabled={busy} onSave={(value) => { void env.saveEnvironment({ baseUrl: value.trim() }); }}/>
      <SavedField id="environment-spec-url" label={t.specUrl} value={env.specUrl} placeholder="/openapi.json" disabled={busy} onSave={(value) => { void env.saveEnvironment({ specUrl: value.trim() || null }); }}/>
      {env.description && <p className="mt-3 text-[11px] leading-5 text-slate-500">{env.description}</p>}
      <EnvironmentSwitches env={env} busy={busy}/>
      <div className="mt-3"><CredentialsCard env={env}/></div>
      <Button type="button" size="1" variant="ghost" color="red" disabled={busy} onClick={() => { void env.deleteEnvironment(); }} className="mt-3"><Trash2 className="size-3.5"/>{t.remove}</Button>
    </>}
    {!!env.environmentError && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{env.environmentError}</Callout.Text></Callout.Root>}
  </div>;
}
