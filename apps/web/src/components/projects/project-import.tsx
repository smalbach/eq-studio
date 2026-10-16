import { useRef, useState } from "react";
import { Button, Callout, TextArea, TextField } from "@radix-ui/themes";
import { CircleAlert, Info, Link2, Upload } from "lucide-react";
import { parseProjectFile } from "@eq/runner-core";
import { API, ApiError } from "@/lib/api";
import { baseUrlOf, documentKind, parseDocument, readImportFiles, specPathFor } from "@/lib/project-documents";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Importación rápida", hint: "Un contrato —OpenAPI 3.0 o 3.1, Swagger 2.0 o una colección de Postman v2.1— por URL, archivo o pegado, o un .eq.json exportado. Con una colección puedes elegir a la vez su entorno de Postman: de él sale la URL base. Se generan las operaciones, los casos y los bodies de ejemplo; revísalos después en «Editar configuración». Para ir paso a paso, usa «Nuevo proyecto».",
    url: "URL del contrato", fromUrl: "Importar desde URL", fromFile: "Archivo de contrato o .eq.json", paste: "o pega el documento (JSON o YAML)", fromText: "Importar texto",
    baseUrl: "URL base de la API (primer entorno)", name: "Nombre del proyecto (opcional)",
    swagger: "Swagger 2.0: se convierte a OpenAPI 3.0 al importarlo.", postman: "Colección de Postman: se genera un OpenAPI 3 a partir de sus solicitudes. Los schemas se infieren de sus ejemplos: revísalos.",
    converted: { swagger: "El contrato era Swagger 2.0 y se convirtió a OpenAPI 3.0.", postman: "El contrato se generó desde una colección de Postman: los schemas se infirieron de sus ejemplos, así que revísalos antes de confiar en la validación." } as Record<string, string>,
    open: "Abrir el proyecto", onlyEnvironment: "Eso es solo un entorno de Postman: elige también la colección (puedes seleccionar los dos archivos a la vez).",
  },
  en: {
    title: "Quick import", hint: "A contract —OpenAPI 3.0 or 3.1, Swagger 2.0 or a Postman collection v2.1— by URL, file or pasted, or an exported .eq.json. With a collection you can pick its Postman environment at the same time: the base URL comes from it. Operations, cases and sample bodies are generated; review them afterwards in \"Edit configuration\". To go step by step, use \"New project\".",
    url: "Contract URL", fromUrl: "Import from URL", fromFile: "Contract file or .eq.json", paste: "or paste the document (JSON or YAML)", fromText: "Import text",
    baseUrl: "API base URL (first environment)", name: "Project name (optional)",
    swagger: "Swagger 2.0: it is converted to OpenAPI 3.0 on import.", postman: "Postman collection: an OpenAPI 3 is generated from its requests. Schemas are inferred from its examples: review them.",
    converted: { swagger: "The contract was Swagger 2.0 and was converted to OpenAPI 3.0.", postman: "The contract was generated from a Postman collection: schemas were inferred from its examples, so review them before trusting the validation." } as Record<string, string>,
    open: "Open the project", onlyEnvironment: "That is only a Postman environment: pick the collection too (you can select both files at once).",
  },
});

/**
 * A new project in one go, without the guide: from a contract — OpenAPI 3, Swagger 2.0 or a
 * Postman collection, by URL (the API reads it, so there is no CORS between the browser and that
 * server), file or pasted — or from a `.eq.json` project file. `onCreated` gets the new project's
 * id. A contract that was converted says so before the project opens: its schemas are not the
 * ones the team wrote.
 */
export function ProjectImport({ busy, onCreated }: { busy: boolean; onCreated: (id: string) => Promise<void> | void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [converted, setConverted] = useState<{ id: string; format: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const firstEnvironment = (target: string, specUrl?: string, environmentName?: string) => [{ name: environmentName ?? target.replace(/^https?:\/\//, ""), baseUrl: target, specUrl: specPathFor(specUrl, target) }];
  let pastedKind: ReturnType<typeof documentKind> = null;
  try { pastedKind = text.trim() ? documentKind(parseDocument(text)) : null; } catch { /* not parseable yet */ }

  /** Runs one import, with the spinner and the error in one place. */
  async function attempt(work: () => Promise<{ id: string; sourceFormat?: string | null }>) {
    setLoading(true);
    setError("");
    setConverted(null);
    try {
      const result = await work();
      if (result.sourceFormat === "swagger" || result.sourceFormat === "postman") setConverted({ id: result.id, format: result.sourceFormat });
      else await onCreated(result.id);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.full : failure instanceof Error ? failure.message : String(failure));
    } finally { setLoading(false); }
  }

  /** Whatever was given — a contract or a project file — becomes a project in the API. */
  async function fromDocument(document: unknown, environment?: { name: string; baseUrl?: string; variables: Record<string, string> } | null) {
    if (documentKind(document) === "project") return { id: (await API.importProject(parseProjectFile(document))).id };
    if (documentKind(document) === "postman-environment") throw new Error(t.onlyEnvironment);
    const target = (baseUrl.trim() || environment?.baseUrl || baseUrlOf(document, undefined, environment?.variables) || "http://127.0.0.1:8080").replace(/\/$/, "");
    return API.createProject({ name: name.trim() || undefined, spec: { document }, environments: firstEnvironment(target, undefined, environment?.name) });
  }

  async function fromFiles(files: File[]) {
    const { contract, environment } = await readImportFiles(files, locale);
    if (!contract) throw new Error(t.onlyEnvironment);
    return fromDocument(contract.document, environment);
  }

  async function fromUrl() {
    const created = await API.createProject({ name: name.trim() || undefined, spec: { url } });
    // The contract knows better than the URL it was read from where the API runs: a Postman
    // collection is often served by a host the API is not on.
    const target = (baseUrl.trim() || created.baseUrl || new URL(url).origin).replace(/\/$/, "");
    await API.createEnvironment(created.id, firstEnvironment(target, url)[0]);
    return created;
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
    <input ref={fileRef} id="project-file" type="file" multiple aria-label={t.fromFile} accept=".json,.yaml,.yml,application/json" disabled={disabled} onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) void attempt(() => fromFiles(files)); }} className="sr-only"/>
    <label className="mt-2 block text-[11px] text-slate-500">{t.paste}<TextArea size="1" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} className="mt-1 h-24 font-mono"/></label>
    {(pastedKind === "swagger" || pastedKind === "postman") && <p className="mt-1 text-[11px] text-slate-500">{t[pastedKind]}</p>}
    <Button type="button" size="1" variant="surface" color="gray" disabled={!text.trim() || disabled} onClick={() => { void attempt(async () => { const created = await fromDocument(parseDocument(text)); setText(""); return created; }); }} className="mt-1">{t.fromText}</Button>
    {converted && <Callout.Root size="1" color="amber" role="status" className="mt-3"><Callout.Icon><Info className="size-4"/></Callout.Icon><Callout.Text>{t.converted[converted.format]} <Button type="button" size="1" variant="soft" color="amber" onClick={() => { void onCreated(converted.id); }} className="ml-1">{t.open}</Button></Callout.Text></Callout.Root>}
    {error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}
  </div>;
}
