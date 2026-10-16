import { useMemo, useState } from "react";
import { AlertDialog, Badge, Button, Callout, Flex, IconButton, SegmentedControl, Table, TextField } from "@radix-ui/themes";
import { ArrowRight, CircleAlert, FolderOpen, Import, Plus, Search, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { ProjectImport } from "@/components/projects/project-import";
import { API, ApiError, type ProjectSummary } from "@/lib/api";
import type { Workspace } from "@/lib/use-workspace";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Proyectos", description: "Cada proyecto es una API con su contrato, sus entornos y sus corridas. Entra en uno para ver su panel, verificarlo o someterlo a carga.",
    newProject: "Nuevo proyecto", importToggle: "Importar", search: "Buscar por nombre o identificador", sortRecent: "Recientes", sortName: "Nombre", sort: "Orden",
    project: "Proyecto", operations: "Operaciones", contract: "Contrato", updated: "Actualizado", open: "Entrar", current: "abierto", remove: "Eliminar proyecto", cancel: "Cancelar",
    confirmRemove: (name: string) => `¿Eliminar el proyecto «${name}»? Sus corridas dejan de verse en la app.`,
    none: "Ningún proyecto coincide con la búsqueda.", count: (shown: number, total: number) => shown === total ? `${total} proyectos` : `${shown} de ${total} proyectos`,
  },
  en: {
    title: "Projects", description: "Each project is one API with its contract, environments and runs. Enter one to see its dashboard, verify it or put it under load.",
    newProject: "New project", importToggle: "Import", search: "Search by name or identifier", sortRecent: "Recent", sortName: "Name", sort: "Order",
    project: "Project", operations: "Operations", contract: "Contract", updated: "Updated", open: "Enter", current: "open", remove: "Delete project", cancel: "Cancel",
    confirmRemove: (name: string) => `Delete the project "${name}"? Its runs stop showing in the app.`,
    none: "No project matches the search.", count: (shown: number, total: number) => shown === total ? `${total} projects` : `${shown} of ${total} projects`,
  },
});

type Sort = "recent" | "name";

/**
 * The home screen: every project of the workspace, to enter one (its dashboard), to add one —
 * with the guide or a quick import — or to delete one. A table rather than cards, so it reads the
 * same with three projects or sixty, with a search and an order on top. While something runs,
 * only the open project can be entered: a run belongs to its project.
 */
export function ProjectsPage({ workspace, busy, now, onEnter, onNewProject }: { workspace: Workspace; busy: boolean; now: number; onEnter: (project: ProjectSummary) => void; onNewProject: () => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = workspace.projects.filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.slug.includes(needle));
    return [...matching].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, locale) : b.updatedAt.localeCompare(a.updatedAt));
  }, [workspace.projects, query, sort, locale]);

  async function remove(item: ProjectSummary) {
    setError("");
    try { await API.archiveProject(item.id); await workspace.refresh(); } catch (failure) { setError(failure instanceof ApiError ? failure.full : String(failure)); }
  }

  /** A project made by the quick import is entered straight away, like one made by the guide. */
  async function created(id: string) {
    await workspace.refresh();
    const summary = (await API.projects()).find((item) => item.id === id);
    setImporting(false);
    if (summary) onEnter(summary);
  }

  return <div>
    <PageHeader title={t.title} description={t.description} actions={<>
      <Button size="1" variant={importing ? "soft" : "surface"} color="gray" highContrast={importing} aria-expanded={importing} onClick={() => setImporting((value) => !value)}><Import className="size-3.5"/>{t.importToggle}</Button>
      <Button size="1" variant="solid" disabled={busy} onClick={onNewProject}><Plus className="size-3.5"/>{t.newProject}</Button>
    </>}/>

    {importing && <Card className="mb-5 p-4"><ProjectImport busy={busy} onCreated={created}/></Card>}

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
        <label className="min-w-56 flex-1"><span className="sr-only">{t.search}</span>
          <TextField.Root size="2" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search}><TextField.Slot><Search className="size-3.5"/></TextField.Slot></TextField.Root>
        </label>
        <SegmentedControl.Root size="1" aria-label={t.sort} value={sort} onValueChange={(value) => setSort(value as Sort)}>
          {(["recent", "name"] as const).map((value) => <SegmentedControl.Item key={value} value={value}>{value === "recent" ? t.sortRecent : t.sortName}</SegmentedControl.Item>)}
        </SegmentedControl.Root>
        <span className="text-[11px] text-slate-500">{t.count(shown.length, workspace.projects.length)}</span>
      </div>

      <div className="overflow-x-auto">
        <Table.Root size="1" variant="ghost" className="text-left text-xs">
          <Table.Header className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <Table.Row><Table.ColumnHeaderCell className="px-4 py-2 font-medium">{t.project}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="px-4 py-2 font-medium">{t.operations}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="hidden px-4 py-2 font-medium sm:table-cell">{t.contract}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="hidden px-4 py-2 font-medium md:table-cell">{t.updated}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="px-4 py-2"><span className="sr-only">{t.open}</span></Table.ColumnHeaderCell></Table.Row>
          </Table.Header>
          <Table.Body>{shown.map((item) => {
            const current = item.id === workspace.activeId;
            return <Table.Row key={item.id} align="center" className={cn(current ? "bg-accent-3" : "hover:bg-accent-2")}>
              <Table.Cell className="px-4 py-2.5">
                <button type="button" disabled={busy && !current} onClick={() => onEnter(item)} className="flex min-w-0 disabled:opacity-50 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-8">
                  <FolderOpen className={cn("size-4 shrink-0", current ? "text-accent-11" : "text-slate-400")}/>
                  <span className="min-w-0"><span className="flex items-center gap-1.5 font-semibold text-slate-800"><span className="truncate">{item.name}</span>{current && <Badge size="1" variant="solid" className="uppercase">{t.current}</Badge>}</span><span className="block truncate font-mono text-[10px] text-slate-400">{item.slug}</span></span>
                </button>
              </Table.Cell>
              <Table.Cell className="px-4 py-2.5 tabular-nums text-slate-600">{item.operationCount}</Table.Cell>
              <Table.Cell className="hidden px-4 py-2.5 font-mono text-[11px] text-slate-600 sm:table-cell">{item.contractVersion ? `v${item.contractVersion}` : "—"}</Table.Cell>
              <Table.Cell className="hidden whitespace-nowrap px-4 py-2.5 text-slate-500 md:table-cell" title={item.updatedAt}>{ago(Date.parse(item.updatedAt), now, locale)}</Table.Cell>
              <Table.Cell className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  <Button size="1" variant="surface" color="gray" disabled={busy && !current} onClick={() => onEnter(item)}>{t.open}<ArrowRight className="size-3"/></Button>
                  <IconButton size="1" variant="ghost" color="gray" disabled={busy} onClick={() => setRemoving(item)} aria-label={`${t.remove}: ${item.name}`} title={t.remove}><Trash2 className="size-3.5"/></IconButton>
                </div>
              </Table.Cell>
            </Table.Row>;
          })}</Table.Body>
        </Table.Root>
        {!shown.length && <p className="px-4 py-8 text-center text-xs text-slate-500">{t.none}</p>}
      </div>
    </Card>
    {error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}
    <AlertDialog.Root open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>{t.remove}</AlertDialog.Title>
        <AlertDialog.Description size="2">{removing ? t.confirmRemove(removing.name) : ""}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel><Button variant="soft" color="gray">{t.cancel}</Button></AlertDialog.Cancel>
          <AlertDialog.Action><Button variant="solid" color="red" onClick={() => { if (removing) void remove(removing); }}>{t.remove}</Button></AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </div>;
}
