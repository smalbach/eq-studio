import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Callout, Select, TextField } from "@radix-ui/themes";
import { CircleAlert, CircleCheck, GitCompareArrows, Link2, TriangleAlert, Upload } from "lucide-react";
import { changesByOperation, describeChange, type SpecDiffSummary } from "@eq/runner-core";
import { MethodBadge } from "@/components/common/method-badge";
import { API, ApiError, type SpecVersionView } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";
import { KEYS, type Workspace } from "@/lib/use-workspace";

const MESSAGES = defineMessages({
  es: {
    title: "Versiones del contrato", hint: "Cada importación guarda una versión inmutable. Compara dos para ver qué cambió y qué rompe a los clientes de la anterior.",
    active: "activa", activate: "Activar", operations: (n: number) => `${n} operaciones`, untitled: "sin versión",
    url: "Nueva versión desde URL", fromUrl: "Importar", fromFile: "Importar archivo",
    from: "Desde", to: "Hasta", compare: "Comparar", noEarlier: "Solo hay una versión: no hay nada con qué comparar.",
    noChanges: "Las dos versiones declaran lo mismo.", breaking: "Rompe", summary: (s: SpecDiffSummary) => `${s.breaking} cambios que rompen · ${s.nonBreaking} compatibles · ${s.operationsAdded} operaciones nuevas · ${s.operationsRemoved} eliminadas`,
    importedBreaking: (n: number) => `La versión importada tiene ${n} ${n === 1 ? "cambio que rompe" : "cambios que rompen"} a los clientes de la anterior.`,
    importedSafe: (n: number) => n ? `Versión importada: ${n} ${n === 1 ? "cambio" : "cambios"}, ninguno rompe a los clientes.` : "Versión importada: sin cambios en lo que declara.",
    existing: "Ese documento ya estaba importado: se reutilizó su versión.", oldest: "La versión activa es la más antigua: elige en «Desde» y «Hasta» qué comparar.",
  },
  en: {
    title: "Contract versions", hint: "Every import keeps an immutable version. Compare two to see what changed and what breaks clients of the older one.",
    active: "active", activate: "Activate", operations: (n: number) => `${n} operations`, untitled: "no version",
    url: "New version from a URL", fromUrl: "Import", fromFile: "Import a file",
    from: "From", to: "To", compare: "Compare", noEarlier: "There is only one version: nothing to compare it with.",
    noChanges: "Both versions declare the same.", breaking: "Breaking", summary: (s: SpecDiffSummary) => `${s.breaking} breaking · ${s.nonBreaking} compatible · ${s.operationsAdded} operations added · ${s.operationsRemoved} removed`,
    importedBreaking: (n: number) => `The imported version has ${n} ${n === 1 ? "change that breaks" : "changes that break"} clients of the previous one.`,
    importedSafe: (n: number) => n ? `Version imported: ${n} ${n === 1 ? "change" : "changes"}, none breaks clients.` : "Version imported: nothing it declares changed.",
    existing: "That document was already imported: its version was reused.", oldest: "The active version is the oldest: pick what to compare in \"From\" and \"To\".",
  },
});

const label = (version: SpecVersionView, untitled: string, locale: "es" | "en") => `${version.version ? `v${version.version}` : untitled} · ${formatDate(Date.parse(version.createdAt), locale)}`;

/**
 * The project's contract versions: import a new one, activate an older one (a rollback), and
 * the changes between any two, grouped by operation with the ones that break clients first in
 * line. An import that breaks clients says so right away.
 */
export function SpecVersions({ workspace, projectId, busy }: { workspace: Workspace; projectId: string; busy: boolean }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const versions = useQuery({ queryKey: KEYS.specVersions(projectId), queryFn: () => API.specVersions(projectId) });
  // Empty means the default: the version before the active one, and the active one.
  const [pair, setPair] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const diff = useQuery({ queryKey: [...KEYS.specVersions(projectId), "diff", pair.from, pair.to], queryFn: () => API.specDiff(projectId, pair.from || undefined, pair.to || undefined), enabled: (versions.data?.length ?? 0) > 1 });
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<{ created: boolean; summary: SpecDiffSummary | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function attempt(work: () => Promise<void>) {
    setLoading(true);
    setError("");
    try { await work(); await workspace.refresh(); } catch (failure) {
      setError(failure instanceof ApiError ? failure.full : failure instanceof Error ? failure.message : String(failure));
    } finally { setLoading(false); }
  }

  const importFrom = (source: { url: string } | { document: unknown }) => attempt(async () => {
    const result = await API.importSpec(projectId, source);
    setImported({ created: result.created, summary: result.diff?.summary ?? null });
    setPair({ from: "", to: "" });
    setUrl("");
  });

  const rows = versions.data ?? [];
  const from = diff.data?.from?.id ?? pair.from;
  const to = diff.data?.to?.id ?? pair.to;
  const disabled = busy || loading;
  const groups = changesByOperation(diff.data?.changes ?? []).sort((a, b) => Number(b.breaking) - Number(a.breaking));
  const changeCount = imported?.summary ? imported.summary.breaking + imported.summary.nonBreaking : 0;

  return <section className="mt-5 border-t border-slate-200 pt-4">
    <p className="text-xs font-semibold text-slate-700">{t.title}</p>
    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{t.hint}</p>

    <label className="mt-3 block text-[11px] text-slate-500">{t.url}<div className="mt-1 flex flex-wrap gap-2"><TextField.Root size="2" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/openapi.json" className="min-w-0 flex-1 font-mono"/><Button type="button" size="2" variant="surface" color="gray" disabled={!url || disabled} loading={loading} onClick={() => { void importFrom({ url }); }} className="shrink-0"><Link2 className="size-3.5"/>{t.fromUrl}</Button><Button type="button" size="2" variant="surface" color="gray" disabled={disabled} onClick={() => fileRef.current?.click()} className="shrink-0"><Upload className="size-3.5"/>{t.fromFile}</Button></div></label>
    <input ref={fileRef} type="file" aria-label={t.fromFile} accept=".json,.yaml,.yml,application/json" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void file.text().then((document) => importFrom({ document })); }} className="sr-only"/>

    {imported && (imported.summary?.breaking
      ? <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><TriangleAlert className="size-4"/></Callout.Icon><Callout.Text>{t.importedBreaking(imported.summary.breaking)}</Callout.Text></Callout.Root>
      : <Callout.Root size="1" color="green" role="status" className="mt-3"><Callout.Icon><CircleCheck className="size-4"/></Callout.Icon><Callout.Text>{imported.created ? t.importedSafe(changeCount) : t.existing}</Callout.Text></Callout.Root>)}
    {error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}

    <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
      {rows.map((version) => <li key={version.id} className="flex items-center gap-2 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono">{version.version ? `v${version.version}` : t.untitled}{version.title ? <span className="text-slate-500"> · {version.title}</span> : null}</span>
        <span className="shrink-0 text-[11px] text-slate-500">{t.operations(version.operationCount)} · {formatDate(Date.parse(version.createdAt), locale)}</span>
        {version.active ? <Badge size="1" color="green" variant="soft">{t.active}</Badge> : <Button type="button" size="1" variant="ghost" disabled={disabled} onClick={() => { void attempt(async () => { await API.activateSpec(projectId, version.id); setPair({ from: "", to: "" }); }); }}>{t.activate}</Button>}
      </li>)}
    </ul>

    {rows.length < 2 ? <p className="mt-3 text-[11px] text-slate-500">{t.noEarlier}</p> : <div className="mt-4">
      <div className="flex flex-wrap items-end gap-2 text-[11px] text-slate-500">
        <GitCompareArrows className="mb-1.5 size-4 text-slate-400"/>
        <label className="flex flex-col gap-1">{t.from}<Select.Root size="1" value={from || undefined} onValueChange={(value) => setPair({ from: value, to })}><Select.Trigger aria-label={t.from} className="font-mono"/><Select.Content>{rows.map((version) => <Select.Item key={version.id} value={version.id}>{label(version, t.untitled, locale)}</Select.Item>)}</Select.Content></Select.Root></label>
        <label className="flex flex-col gap-1">{t.to}<Select.Root size="1" value={to || undefined} onValueChange={(value) => setPair({ from, to: value })}><Select.Trigger aria-label={t.to} className="font-mono"/><Select.Content>{rows.map((version) => <Select.Item key={version.id} value={version.id}>{label(version, t.untitled, locale)}</Select.Item>)}</Select.Content></Select.Root></label>
      </div>
      {diff.error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{diff.error instanceof ApiError ? diff.error.full : String(diff.error)}</Callout.Text></Callout.Root>}
      {diff.data && (diff.data.from ? <>
        <Callout.Root size="1" color={diff.data.summary.breaking ? "red" : diff.data.changes.length ? "amber" : "green"} role="status" className="mt-3"><Callout.Icon>{diff.data.summary.breaking ? <TriangleAlert className="size-4"/> : <CircleCheck className="size-4"/>}</Callout.Icon><Callout.Text>{diff.data.changes.length ? t.summary(diff.data.summary) : t.noChanges}</Callout.Text></Callout.Root>
        <ul aria-label={t.compare} className="mt-3 space-y-2">
          {groups.map((group) => <li key={`${group.method} ${group.path}`} className={`rounded-md border px-3 py-2 ${group.breaking ? "border-rose-200 bg-rose-50/60" : "border-slate-200"}`}>
            <p className="flex items-center gap-2 text-xs"><MethodBadge method={group.method}/><span className="truncate font-mono">{group.path}</span>{group.operationId && <span className="truncate text-[11px] text-slate-500">{group.operationId}</span>}</p>
            <ul className="mt-1.5 space-y-1">
              {[...group.changes].sort((a, b) => Number(b.breaking) - Number(a.breaking)).map((change, index) => <li key={index} className="flex items-start gap-2 text-[11px] leading-5">
                {change.breaking ? <Badge size="1" color="red" variant="solid" className="shrink-0">{t.breaking}</Badge> : <Badge size="1" color="gray" variant="soft" className="shrink-0">·</Badge>}
                <span className="font-mono text-slate-700">{describeChange(change, locale)}</span>
              </li>)}
            </ul>
          </li>)}
        </ul>
      </> : <p className="mt-3 text-[11px] text-slate-500">{t.oldest}</p>)}
    </div>}
  </section>;
}
