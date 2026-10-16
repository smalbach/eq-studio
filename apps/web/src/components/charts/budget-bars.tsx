import { X } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import type { GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { empty: "Sin datos.", limit: (budget: number, unit: string) => `Límite ${budget} ${unit}`, legendLimit: "límite", legendOver: "lo supera" },
  en: { empty: "No data.", limit: (budget: number, unit: string) => `Limit ${budget} ${unit}`, legendLimit: "limit", legendOver: "exceeds it" },
});

/**
 * A value against its limit, one row each: a bar for the value and a tick for the budget, on one
 * shared scale so rows compare. Over the limit the bar turns rose and the row says so with a ✕
 * and the ratio — never colour alone.
 */
export type BudgetRow = { key: string; label: string; detail?: string; value: number; budget: number | null; onClick?: () => void };

export function BudgetBars({ title, info, rows, unit = "ms", emptyLabel }: { title: string; info?: GlossaryKey; rows: BudgetRow[]; unit?: string; emptyLabel?: string }) {
  const t = useMessages(MESSAGES);
  const top = Math.max(1, ...rows.map((row) => Math.max(row.value, row.budget ?? 0))) * 1.05;
  return <div className="min-w-0">
    <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-700">{title}{info && <InfoTip id={info} size="xs"/>}</p>
    {rows.length ? <ul className="space-y-1.5">{rows.map((row) => {
      const over = row.budget != null && row.value >= row.budget;
      const Tag = row.onClick ? "button" : "div";
      return <li key={row.key}><Tag {...(row.onClick ? { type: "button" as const, onClick: row.onClick } : {})} className={cn("grid w-full grid-cols-[minmax(0,180px)_minmax(0,1fr)_96px] items-center gap-3 rounded-md px-1 py-0.5 text-left text-[11px]", row.onClick && "hover:bg-slate-50")}>
        <span className="min-w-0"><span className="block truncate font-mono text-slate-700" title={row.label}>{row.label}</span>{row.detail && <span className="block truncate text-[10px] text-slate-400" title={row.detail}>{row.detail}</span>}</span>
        <span className="relative h-3 rounded-full bg-slate-100">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-rose-500" : "bg-sky-500")} style={{ width: `${(row.value / top) * 100}%` }}/>
          {row.budget != null && <span title={t.limit(row.budget, unit)} className="absolute -inset-y-1 w-0.5 rounded bg-slate-700" style={{ left: `${(row.budget / top) * 100}%` }}/>}
        </span>
        <span className={cn("flex items-center justify-end gap-1 font-mono", over ? "text-rose-600" : "text-slate-600")}>{over && <X className="size-3"/>}{Math.round(row.value)} {unit}{row.budget != null && <span className="text-[10px] text-slate-400">/{row.budget}</span>}</span>
      </Tag></li>;
    })}</ul> : <p className="text-[11px] text-slate-400">{emptyLabel ?? t.empty}</p>}
    {rows.some((row) => row.budget != null) && <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400"><span className="inline-block h-3 w-0.5 rounded bg-slate-700"/>{t.legendLimit} · <X className="size-3 text-rose-600"/>{t.legendOver}</p>}
  </div>;
}
