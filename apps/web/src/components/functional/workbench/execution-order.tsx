import { Badge, IconButton, SegmentedControl } from "@radix-ui/themes";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MethodBadge } from "@/components/common/method-badge";
import type { Workbench } from "@/components/functional/workbench/use-workbench";
import { moveEndpoint, ORDER_MODES, type OrderMode } from "@/lib/execution-plan";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Orden de ejecución",
    modes: { contract: "Contrato", safe: "Lecturas primero", custom: "Personalizado" },
    hints: { contract: "El orden en que bundled.yaml declara las 45 operaciones.", safe: "GET, POST, PUT, PATCH y por último DELETE. Es el orden por defecto: un DELETE que borra de más no puede dejar en rojo a los casos que vienen después, porque ya no queda ninguno.", custom: "El orden que fijes a mano. Se parte del orden visible al activarlo." },
    selected: (endpoints: number, cases: number) => `${endpoints} seleccionados · ${cases} casos`,
    up: (id: string) => `Subir ${id}`,
    down: (id: string) => `Bajar ${id}`,
  },
  en: {
    title: "Execution order",
    modes: { contract: "Contract", safe: "Reads first", custom: "Custom" },
    hints: { contract: "The order in which bundled.yaml declares the 45 operations.", safe: "GET, POST, PUT, PATCH and DELETE last. It is the default order: a DELETE that removes too much cannot turn the cases after it red, because none are left.", custom: "The order you set by hand. It starts from the order on screen when you switch to it." },
    selected: (endpoints: number, cases: number) => `${endpoints} selected · ${cases} cases`,
    up: (id: string) => `Move ${id} up`,
    down: (id: string) => `Move ${id} down`,
  },
});

/**
 * The order the queue runs in, and the endpoints it runs.
 *
 * The custom list shows every operation, not only the selected ones: an order is a property of
 * the matrix and stays fixed when the selection changes, so reordering inside a subset and
 * losing that order the moment another endpoint is ticked would be worse than useless.
 */
export function ExecutionOrder({ bench, busy }: { bench: Workbench; busy: boolean }) {
  const t = useMessages(MESSAGES);
  const { orderMode: mode, orderedEndpoints, customOrder, selectedEndpointIds, selectionQueue } = bench;
  const hint = t.hints[mode];
  const move = (id: string, direction: -1 | 1) => bench.setCustomOrder((current) => moveEndpoint(current, id, direction));
  return <Card className="mb-5 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><ListOrdered className="size-4 text-slate-400"/>{t.title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl.Root size="1" value={mode} disabled={busy} onValueChange={(value) => { if (value) bench.changeOrderMode(value as OrderMode); }}>{ORDER_MODES.map((option) => <SegmentedControl.Item key={option} value={option}>{t.modes[option]}</SegmentedControl.Item>)}</SegmentedControl.Root>
        <Badge size="1" variant="soft" color="gray">{t.selected(selectedEndpointIds.length, selectionQueue.length)}</Badge>
      </div>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{hint}</p>
    {mode !== "contract" && <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-200">
      {orderedEndpoints.map((endpoint, index) => <div key={endpoint.id} className={cn("flex items-center gap-3 border-b border-slate-100 px-3 py-1.5 last:border-b-0", selectedEndpointIds.includes(endpoint.id) && "bg-accent-2")}>
        <span className="w-6 shrink-0 text-right font-mono text-[10px] text-slate-400">{index + 1}</span>
        <MethodBadge method={endpoint.method} className="w-16 justify-center"/>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{endpoint.path}</span>
        <IconButton size="1" variant="surface" color="gray" aria-label={t.up(endpoint.id)} disabled={busy || mode !== "custom" || customOrder.indexOf(endpoint.id) <= 0} onClick={() => move(endpoint.id, -1)} className="shrink-0"><ArrowUp className="size-3"/></IconButton>
        <IconButton size="1" variant="surface" color="gray" aria-label={t.down(endpoint.id)} disabled={busy || mode !== "custom" || customOrder.indexOf(endpoint.id) >= customOrder.length - 1} onClick={() => move(endpoint.id, 1)} className="shrink-0"><ArrowDown className="size-3"/></IconButton>
      </div>)}
    </div>}
  </Card>;
}
