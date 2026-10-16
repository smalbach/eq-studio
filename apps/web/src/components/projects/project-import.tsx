import { useRef, useState } from "react";
import { Button, Callout, TextArea, TextField } from "@radix-ui/themes";
import { CircleAlert, Link2, Upload } from "lucide-react";
import { parseProjectFile } from "@eq/runner-core";
import { API, ApiError } from "@/lib/api";
import { baseUrlOf, parseDocument, specPathFor } from "@/lib/project-documents";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Importación rápida", hint: "Un contrato OpenAPI 3 (por URL, archivo o pegado) o un .eq.json exportado. Se generan las operaciones, los casos y los bodies de ejemplo; revísalos después en «Editar configuración». Para ir paso a paso, usa «Nuevo proyecto».",
    url: "URL del documento OpenAPI", fromUrl: "Importar desde URL", fromFile: "Archivo OpenAPI o .eq.json", paste: "o pega el documento (JSON o YAML)", fromText: "Importar texto",
    baseUrl: "URL base de la API (primer entorno)", name: "Nombre del proyecto (opcional)",
  },
  en: {
    title: "Quick import", hint: "An OpenAPI 3 contract (by URL, file or pasted) or an exported .eq.json. Operations, cases and sample bodies are generated; review them afterwards in \"Edit configuration\". To go step by step, use \"New project\".",
    url: "OpenAPI document URL", fromUrl: "Import from URL", fromFile: "OpenAPI file or .eq.json", paste: "or paste the document (JSON or YAML)", fromText: "Import text",
    baseUrl: "API base URL (first environment)", name: "Project name (optional)",
  },
});

/**
 * A new project in one go, without the guide: from an OpenAPI document — by URL (the API reads
 * it, so there is no CORS between the browser and that server), file or pasted — or from a
 * `.eq.json` project file. `onCreated` gets the new project's id.
 */
export function ProjectImport({ busy, onCreated }: { busy: boolean; onCreated: (id: string) => Promise<void> | void }) {
  const t = useMessages(MESSAGES);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const firstEnvironment = (target: string, specUrl?: string) => [{ name: target.replace(/^https?:\/\//, ""), baseUrl: target, specUrl: specPathFor(specUrl, target) }];

  /** Runs one import, with the spinner and the error in one place. */
  async function attempt(work: () => Promise<string>) {
    setLoading(true);
    setError("");
    try { await onCreated(await work()); } catch (failure) {
      setError(failure instanceof ApiError ? failure.full : failure instanceof Error ? failure.message : String(failure));
    } finally { setLoading(false); }
  }

  /** Whatever was given — an OpenAPI document or a project file — becomes a project in the API. */
  async function fromDocument(document: unknown) {
    if ((document as Record<string, unknown>)?.format === "endpoint-quality/project") return (await API.importProject(parseProjectFile(document))).id;
    const target = (baseUrl.trim() || baseUrlOf(document) || "http://127.0.0.1:8080").replace(/\/$/, "");
    return (await API.createProject({ name: name.trim() || undefined, spec: { document }, environments: firstEnvironment(target) })).id;
  }

  async function fromUrl() {
    const target = (baseUrl.trim() || new URL(url).origin).replace(/\/$/, "");
    return (await API.createProject({ name: name.trim() || undefined, spec: { url }, environments: firstEnvironment(target, url) })).id;
  }

  const disabled = busy || loading;
  return <div>
    <p className="text-xs font-semibold text-slate-700">{t.title}</p>
    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{t.hint}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="text-[11px] text-slate-500">{t.name}<TextField.Root size="2" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 font-mono"/></label>
      <label className="text-[11px] text-slate-500">{t.baseUrl}<TextField.Root size="2" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" className="mt-1 font-mono"/></label>
    </div>
    <label className="mt-2 block text-[11px] text-slate-500">{t.url}<div className="mt-1 flex gap-2"><TextField.Root size="2" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/openapi.json" className="flex-1 font-mono"/><Button type="button" size="2" variant="surface" color="gray" disabled={!url || disabled} loading={loading} onClick={() => { void attempt(fromUrl); }} className="shrink-0"><Link2 className="size-3.5"/>{t.fromUrl}</Button></div></label>
    <Button type="button" size="1" variant="surface" color="gray" disabled={disabled} onClick={() => fileRef.current?.click()} className="mt-2"><Upload className="size-3.5"/>{t.fromFile}</Button>
    <input ref={fileRef} id="project-file" type="file" aria-label={t.fromFile} accept=".json,.yaml,.yml,application/json" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attempt(async () => fromDocument(parseDocument(await file.text()))); }} className="sr-only"/>
    <label className="mt-2 block text-[11px] text-slate-500">{t.paste}<TextArea size="1" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} className="mt-1 h-24 font-mono"/></label>
    <Button type="button" size="1" variant="surface" color="gray" disabled={!text.trim() || disabled} onClick={() => { void attempt(async () => { const id = await fromDocument(parseDocument(text)); setText(""); return id; }); }} className="mt-1">{t.fromText}</Button>
    {error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}
  </div>;
}
