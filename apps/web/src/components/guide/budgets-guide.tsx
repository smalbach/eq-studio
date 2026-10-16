import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, IconButton, Table, TextField } from "@radix-ui/themes";
import { ArrowDown, ArrowUp, CircleCheck, Plus, Trash2 } from "lucide-react";
import { localized, matchBudgetRule, type BudgetRule, type HttpMethod, type LocalizedText } from "@eq/runner-core";
import { errorText, Example, GuideFrame, Notice } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import { MethodBadge } from "@/components/common/method-badge";
import { API } from "@/lib/api";
import { useProject } from "@/lib/project-store";
import type { Workspace } from "@/lib/use-workspace";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    howTitle: "Cómo funcionan", howIntro: "Un presupuesto es cuánto puede tardar una operación, medido en el p95 de sus muestras. Se declara como una lista ordenada de reglas.",
    how: [
      "Las reglas se prueban en orden y gana la primera que coincide: lo específico va antes que lo general.",
      "Una regla coincide si coinciden todos sus filtros: métodos, path (un glob: * es un segmento, ** cualquier profundidad) y query (una expresión regular sobre la ruta con su query string).",
      "«Sin presupuesto» (ms: null) corta la búsqueda: esas operaciones no reciben aserción de latencia.",
      "Una operación que ninguna regla cubre tampoco recibe aserción. Un presupuesto que no existe no es uno que pasa: no inventes números, pon los que el servicio se compromete a cumplir.",
    ],
    current: (n: number) => n ? `El proyecto tiene ${n} reglas.` : "El proyecto aún no tiene reglas: ninguna operación tiene aserción de latencia.",
    rulesTitle: "Reglas", rulesIntro: "Edita las reglas y mira debajo qué regla decide cada operación.", methods: "Métodos (ninguno = todos)", path: "Path (glob)", query: "Query (regex)", ms: "ms", none: "sin presupuesto", label: "Etiqueta (opcional)",
    add: "Añadir regla", up: "Subir", down: "Bajar", remove: "Quitar", preview: "Vista previa", rule: (n: number) => `regla ${n}`, noRule: "ninguna regla", noBudget: "sin aserción",
    invalidRegex: (n: number) => `Regla ${n}: la query no es una expresión regular válida.`, invalidMs: (n: number) => `Regla ${n}: ms debe ser un número positivo, o vacío para «sin presupuesto».`,
    saveTitle: "Guardar", saveIntro: "Las reglas se guardan en el proyecto y se validan contra el contrato.", save: "Guardar presupuestos", saved: "Presupuestos guardados.", covered: (n: number, total: number) => `${n} de ${total} operaciones tienen presupuesto.`, finish: "Terminar",
    enforceNote: "Recuerda: en un entorno con «Exigir presupuestos» apagado, la latencia se informa pero no decide el caso.",
  },
  en: {
    howTitle: "How they work", howIntro: "A budget is how long an operation may take, measured on the p95 of its samples. It is declared as an ordered list of rules.",
    how: [
      "Rules are tried in order and the first one that matches wins: specific goes before general.",
      "A rule matches when all its filters match: methods, path (a glob: * is one segment, ** any depth) and query (a regular expression over the path with its query string).",
      "\"No budget\" (ms: null) stops the search: those operations get no latency assertion.",
      "An operation no rule covers gets no assertion either. A budget that does not exist is not a budget that passes: do not invent numbers, use the ones the service commits to.",
    ],
    current: (n: number) => n ? `The project has ${n} rules.` : "The project has no rules yet: no operation has a latency assertion.",
    rulesTitle: "Rules", rulesIntro: "Edit the rules and see below which rule decides each operation.", methods: "Methods (none = all)", path: "Path (glob)", query: "Query (regex)", ms: "ms", none: "no budget", label: "Label (optional)",
    add: "Add rule", up: "Move up", down: "Move down", remove: "Remove", preview: "Preview", rule: (n: number) => `rule ${n}`, noRule: "no rule", noBudget: "no assertion",
    invalidRegex: (n: number) => `Rule ${n}: the query is not a valid regular expression.`, invalidMs: (n: number) => `Rule ${n}: ms must be a positive number, or empty for "no budget".`,
    saveTitle: "Save", saveIntro: "The rules are saved in the project and validated against the contract.", save: "Save budgets", saved: "Budgets saved.", covered: (n: number, total: number) => `${n} of ${total} operations have a budget.`, finish: "Finish",
    enforceNote: "Remember: in an environment with \"Enforce budgets\" off, latency is reported but does not decide the case.",
  },
});

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** A rule as the form edits it: `ms` as typed, the label kept as it was unless edited. */
type Row = { methods: HttpMethod[]; path: string; query: string; ms: string; label: LocalizedText | undefined; source?: string };

const toRow = (rule: BudgetRule): Row => ({ methods: rule.methods ?? [], path: rule.path ?? "", query: rule.query ?? "", ms: rule.ms === null ? "" : String(rule.ms), label: rule.label, source: rule.source });
const toRule = (row: Row): BudgetRule => ({
  ...(row.methods.length ? { methods: row.methods } : {}),
  ...(row.path.trim() ? { path: row.path.trim() } : {}),
  ...(row.query.trim() ? { query: row.query.trim() } : {}),
  ms: row.ms.trim() ? Number(row.ms) : null,
  ...(row.label && (typeof row.label !== "string" || row.label.trim()) ? { label: row.label } : {}),
  ...(row.source ? { source: row.source } : {}),
});

function problemsOf(rows: Row[], t: (typeof MESSAGES)["es"]) {
  return rows.flatMap((row, index) => {
    const problems: string[] = [];
    if (row.query.trim()) { try { new RegExp(row.query); } catch { problems.push(t.invalidRegex(index + 1)); } }
    if (row.ms.trim() && !(Number(row.ms) > 0)) problems.push(t.invalidMs(index + 1));
    return problems;
  });
}

/** Latency budget rules, with a live view of which rule each operation falls under. */
export function BudgetsGuide({ guide, workspace, step, onStep, onDone }: { guide: GuideEntry; workspace: Workspace; step: number; onStep: (step: number) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const client = useQueryClient();
  const project = useProject();
  const config = useQuery({ queryKey: ["guide-config", project.id], queryFn: () => API.config(project.id), enabled: Boolean(project.id) });
  const [edited, setEdited] = useState<Row[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const rows = edited ?? (config.data?.config.budgets ?? []).map(toRow);
  const problems = problemsOf(rows, t);
  const rules = rows.map(toRule);
  const operations = project.file.project.operations;
  // The preview runs the engine's own matcher, so what it shows is what a run will do.
  const preview = problems.length ? [] : operations.map((operation) => {
    const rule = matchBudgetRule(rules, operation.method, operation.path);
    return { operation, index: rule ? rules.indexOf(rule) : -1, ms: rule?.ms ?? null };
  });
  const covered = preview.filter((item) => item.ms !== null).length;
  const frame = { guide, step, onStep, maxStep: 2 };
  const setRows = (next: Row[]) => { setEdited(next); setSaved(false); };
  const change = (index: number, patch: Partial<Row>) => setRows(rows.map((row, position) => position === index ? { ...row, ...patch } : row));
  const move = (index: number, by: number) => { const next = [...rows]; const [row] = next.splice(index, 1); next.splice(index + by, 0, row); setRows(next); };

  async function save() {
    setError("");
    try {
      await API.updateSection(project.id, "budgets", rules, config.data?.rev);
      await client.invalidateQueries({ queryKey: ["guide-config", project.id] });
      await workspace.refresh();
      setEdited(null);
      setSaved(true);
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  const example = <Example code={`"budgets": [\n  { "path": "/health", "ms": 50 },\n  { "methods": ["POST"], "path": "**/bulk", "ms": 2000 },\n  { "methods": ["GET"], "query": "[?&]q=", "ms": 400 },\n  { "methods": ["GET"], "ms": 200 },\n  { "methods": ["POST", "PUT", "PATCH", "DELETE"], "ms": null }\n]`}/>;

  if (step === 0) return <GuideFrame {...frame} title={t.howTitle} intro={t.howIntro} canNext doc="conceptos" example={example}>
    <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-5 text-slate-700">{t.how.map((line) => <li key={line}>{line}</li>)}</ol>
    {config.data && <Notice>{t.current(config.data.config.budgets?.length ?? 0)}</Notice>}
  </GuideFrame>;

  if (step === 1) return <GuideFrame {...frame} title={t.rulesTitle} intro={t.rulesIntro} canNext={!problems.length} doc="formato" example={example}>
    <ol className="space-y-2">{rows.map((row, index) => <li key={index} className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">#{index + 1}</span>
        <span className="flex gap-1">
          <IconButton type="button" size="1" variant="surface" color="gray" aria-label={t.up} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-3"/></IconButton>
          <IconButton type="button" size="1" variant="surface" color="gray" aria-label={t.down} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-3"/></IconButton>
          <IconButton type="button" size="1" variant="surface" color="red" aria-label={t.remove} onClick={() => setRows(rows.filter((_, position) => position !== index))}><Trash2 className="size-3"/></IconButton>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label={t.methods}>{METHODS.map((method) => <Button key={method} type="button" size="1" variant={row.methods.includes(method) ? "soft" : "outline"} color={row.methods.includes(method) ? undefined : "gray"} aria-pressed={row.methods.includes(method)} onClick={() => change(index, { methods: row.methods.includes(method) ? row.methods.filter((item) => item !== method) : [...row.methods, method] })} className="font-mono text-[10px]">{method}</Button>)}<span className="ml-1 text-[10px] text-slate-400">{t.methods}</span></div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_2fr_1fr_2fr]">
        <TextField.Root size="2" aria-label={t.path} value={row.path} onChange={(event) => change(index, { path: event.target.value })} placeholder={`${t.path}: /v1/orders/**`} className="font-mono"/>
        <TextField.Root size="2" aria-label={t.query} value={row.query} onChange={(event) => change(index, { query: event.target.value })} placeholder={`${t.query}: [?&]q=`} className="font-mono"/>
        <TextField.Root size="2" aria-label={t.ms} type="number" min={1} value={row.ms} onChange={(event) => change(index, { ms: event.target.value })} placeholder={t.none} className="font-mono"/>
        <TextField.Root size="2" aria-label={t.label} value={row.label ? localized(locale, row.label) : ""} onChange={(event) => change(index, { label: event.target.value })} placeholder={t.label} />
      </div>
    </li>)}</ol>
    <Button type="button" size="2" variant="surface" color="gray" onClick={() => setRows([...rows, { methods: ["GET"], path: "", query: "", ms: "200", label: undefined }])}><Plus className="size-3.5"/>{t.add}</Button>
    {problems.length > 0 && <Notice tone="error">{problems.join("\n")}</Notice>}
    {!problems.length && <div>
      <p className="mb-1 text-[11px] font-medium text-slate-600">{t.preview} · {t.covered(covered, operations.length)}</p>
      <div className="max-h-80 overflow-auto rounded-xl border border-slate-200"><Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{preview.map(({ operation, index, ms }) => <Table.Row key={operation.id}>
        <Table.Cell className="px-3"><MethodBadge method={operation.method}/></Table.Cell>
        <Table.Cell className="px-3 font-mono text-slate-700">{operation.path}</Table.Cell>
        <Table.Cell className="px-3 text-slate-500">{index >= 0 ? t.rule(index + 1) : t.noRule}</Table.Cell>
        <Table.Cell justify="end" className={cn("px-3 tabular-nums", ms !== null ? "font-semibold text-slate-900" : "text-slate-400")}>{ms !== null ? `< ${ms} ms` : t.noBudget}</Table.Cell>
      </Table.Row>)}</Table.Body></Table.Root></div>
    </div>}
  </GuideFrame>;

  return <GuideFrame {...frame} title={t.saveTitle} intro={t.saveIntro} canNext={false} hideNext doc="problemas" example={<Example code={JSON.stringify(rules, null, 2)}/>}>
    <p className="text-xs text-slate-700">{t.covered(covered, operations.length)}</p>
    <Notice>{t.enforceNote}</Notice>
    {saved ? <div className="flex flex-wrap items-center gap-2"><Notice tone="ok">{t.saved}</Notice><Button type="button" size="2" variant="surface" color="gray" onClick={() => onDone("home")}><CircleCheck className="size-3.5"/>{t.finish}</Button></div>
      : <Button type="button" size="2" disabled={problems.length > 0 || !config.data} onClick={() => { void save(); }}>{t.save}</Button>}
    {error && <Notice tone="error">{error}</Notice>}
  </GuideFrame>;
}
