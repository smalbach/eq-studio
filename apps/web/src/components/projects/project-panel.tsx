import { useState } from "react";
import { Button, Callout, IconButton, TextArea } from "@radix-ui/themes";
import { ArrowLeftRight, CircleAlert, CircleCheck, Download, FileJson, FolderOpen, RefreshCw, Save, X } from "lucide-react";
import { useProject } from "@/lib/project-store";
import { API, ApiError } from "@/lib/api";
import type { Workspace } from "@/lib/use-workspace";
import { download } from "@/lib/format";
import { defineMessages, useMessages } from "@/lib/i18n";
import { SpecVersions } from "@/components/projects/spec-versions";

const MESSAGES = defineMessages({
  es: {
    title: "Proyecto", close: "Cerrar", switchProject: "Cambiar de proyecto", operations: (n: number) => `${n} operaciones`, contract: (version: string) => `contrato v${version}`,
    exportFile: "Exportar .eq.json", edit: "Editar configuración", save: "Guardar cambios", cancel: "Cancelar", guide: "Guía paso a paso",
    editHint: "La configuración del proyecto (sin las operaciones, que vienen del contrato). Cada sección se valida contra el contrato al guardar.",
    regenerate: "Regenerar desde el contrato", regenerated: "Configuración regenerada: lo ajustado a mano se conservó.", saved: "Configuración guardada.",
  },
  en: {
    title: "Project", close: "Close", switchProject: "Switch project", operations: (n: number) => `${n} operations`, contract: (version: string) => `contract v${version}`,
    exportFile: "Export .eq.json", edit: "Edit configuration", save: "Save changes", cancel: "Cancel", guide: "Step-by-step guide",
    editHint: "The project's configuration (without its operations, which come from the contract). Each section is validated against the contract on save.",
    regenerate: "Regenerate from the contract", regenerated: "Configuration regenerated: hand-tuned values were kept.", saved: "Configuration saved.",
  },
});

/** What the editor leaves out: the name and the operations come from the contract. */
const FIXED = ["name", "contractVersion", "operations"];

/**
 * The open project and what can be done with it: export it, edit or regenerate its
 * configuration, or go back to the projects to switch. Creating, importing and deleting
 * projects live on the projects screen (home), which holds the list however long it gets.
 */
export function ProjectPanel({ workspace, busy, onClose, onGuide, onSwitch }: { workspace: Workspace; busy: boolean; onClose?: () => void; onGuide?: () => void; onSwitch: () => void }) {
  const t = useMessages(MESSAGES);
  const project = useProject();
  const config = project.file.project;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const report = (message: string, isError = false) => { setError(isError ? message : ""); setNotice(isError ? "" : message); };
  const failed = (failure: unknown) => report(failure instanceof ApiError ? failure.full : failure instanceof Error ? failure.message : String(failure), true);

  /** Each changed section is saved on its own, validated by the API against the contract. */
  async function saveEdit() {
    try {
      const edited = JSON.parse(editing ?? "") as Record<string, unknown>;
      const current = config as unknown as Record<string, unknown>;
      let rev = project.rev;
      for (const [key, value] of Object.entries(edited)) {
        if (FIXED.includes(key) || JSON.stringify(current[key]) === JSON.stringify(value)) continue;
        rev = (await API.updateSection(project.id, key, value, rev)).rev;
      }
      for (const key of Object.keys(current)) if (!(key in edited) && !FIXED.includes(key)) rev = (await API.updateSection(project.id, key, null, rev)).rev;
      setEditing(null);
      await workspace.refresh();
      report(t.saved);
    } catch (failure) {
      failed(failure);
    }
  }

  async function regenerate() {
    try { await API.generateConfig(project.id, "merge"); await workspace.refresh(); report(t.regenerated); } catch (failure) { failed(failure); }
  }

  async function exportFile() {
    try { download(`${project.slug}.eq.json`, JSON.stringify(await API.exportProject(project.id), null, 2), "application/json"); } catch (failure) { failed(failure); }
  }

  const editable = () => JSON.stringify(Object.fromEntries(Object.entries(config).filter(([key]) => !FIXED.includes(key))), null, 2);

  return <div>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold"><FolderOpen className="size-4 shrink-0 text-slate-400"/><span className="truncate">{config.name}</span></p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">{project.slug} · {t.operations(config.operations.length)}{config.contractVersion ? ` · ${t.contract(config.contractVersion)}` : ""}</p>
      </div>
      {onClose && <IconButton type="button" size="2" variant="ghost" color="gray" onClick={onClose} aria-label={t.close} className="shrink-0"><X className="size-4"/></IconButton>}
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" size="2" variant="soft" disabled={busy} onClick={onSwitch}><ArrowLeftRight className="size-3.5"/>{t.switchProject}</Button>
      {onGuide && <Button type="button" size="2" variant="surface" color="gray" onClick={onGuide}>{t.guide}</Button>}
      <Button type="button" size="2" variant="surface" color="gray" disabled={!project.id} onClick={() => { void exportFile(); }}><Download className="size-3.5"/>{t.exportFile}</Button>
      <Button type="button" size="2" variant={editing !== null ? "soft" : "surface"} color="gray" disabled={busy || !project.id} onClick={() => setEditing(editing === null ? editable() : null)} aria-expanded={editing !== null}><FileJson className="size-3.5"/>{t.edit}</Button>
      <Button type="button" size="2" variant="surface" color="gray" disabled={busy || !project.id} onClick={() => { void regenerate(); }}><RefreshCw className="size-3.5"/>{t.regenerate}</Button>
    </div>

    {editing !== null && <div className="mt-3">
      <p className="text-[11px] leading-5 text-slate-500">{t.editHint}</p>
      <TextArea size="1" aria-label={t.edit} value={editing} onChange={(event) => setEditing(event.target.value)} spellCheck={false} className="mt-2 h-80 font-mono leading-5"/>
      <div className="mt-2 flex gap-2"><Button type="button" size="2" variant="solid" onClick={() => { void saveEdit(); }}><Save className="size-3.5"/>{t.save}</Button><Button type="button" size="2" variant="surface" color="gray" onClick={() => setEditing(null)}>{t.cancel}</Button></div>
    </div>}

    {notice && <Callout.Root size="1" color="green" role="status" className="mt-3"><Callout.Icon><CircleCheck className="size-4"/></Callout.Icon><Callout.Text>{notice}</Callout.Text></Callout.Root>}
    {error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}

    {project.id && <SpecVersions workspace={workspace} projectId={project.id} busy={busy}/>}
  </div>;
}
