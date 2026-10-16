import { Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import type { GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { before: (previous: number, unit: string) => `Antes ${previous}${unit}`, pass: "Pasa", fail: "No pasa" },
  en: { before: (previous: number, unit: string) => `Before ${previous}${unit}`, pass: "Pass", fail: "Fail" },
});

type Tone = "good" | "bad" | "warn" | "neutral";
const TONE_TEXT: Record<Tone, string> = { good: "text-emerald-600", bad: "text-rose-600", warn: "text-amber-600", neutral: "" };

/** A headline number in its own card. */
export function Stat({ label, value, hint, tone = "neutral", info, icon }: { label: string; value: string; hint?: React.ReactNode; tone?: Tone; info?: GlossaryKey; icon?: React.ReactNode }) {
  return <Card className="flex items-start justify-between gap-3 p-4">
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs font-medium text-slate-500">{label}{info && <InfoTip id={info} size="xs"/>}</p>
      <p className={cn("mt-1 text-2xl font-semibold", TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
    {icon && <span className="text-slate-300">{icon}</span>}
  </Card>;
}

/** A small number inside a card. */
export function Mini({ label, value, info, tone = "neutral" }: { label: string; value: string; info?: GlossaryKey; tone?: Tone }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">{label}{info && <InfoTip id={info} size="xs"/>}</p><p className={cn("mt-0.5 font-mono text-sm font-semibold text-slate-700", TONE_TEXT[tone])}>{value}</p></div>;
}

/** Passed and failed as one bar, with the numbers written next to it: never colour alone. */
/** `neutral` draws the remainder grey: "not covered yet" rather than "failed". */
export function SplitBar({ label, passed, failed, onClick, active, neutral }: { label: string; passed: number; failed: number; onClick?: () => void; active?: boolean; neutral?: boolean }) {
  const total = passed + failed;
  return <button type="button" onClick={onClick} className={cn("grid w-full grid-cols-[130px_minmax(0,1fr)_92px] items-center gap-3 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors", onClick && "hover:bg-accent-2", active && "bg-accent-3")}>
    <span className="truncate font-medium text-slate-700" title={label}>{label}</span>
    <span className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-slate-100">
      {passed > 0 && <span className="h-full rounded-l-full bg-emerald-500 last:rounded-r-full" style={{ width: `${(passed / total) * 100}%` }}/>}
      {failed > 0 && <span className={cn("h-full rounded-r-full first:rounded-l-full", neutral ? "bg-slate-300" : "bg-rose-500")} style={{ width: `${(failed / total) * 100}%` }}/>}
    </span>
    <span className="text-right font-mono text-slate-500"><span className="text-emerald-700">{passed}</span> · <span className={failed && !neutral ? "text-rose-600" : ""}>{failed}</span> / {total}</span>
  </button>;
}

/** A count per category as a bar with its number and share beside it. */
export function CountBars({ rows, color = "bg-sky-500" }: { rows: { key: string; count: number }[]; color?: string }) {
  const top = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  return <div className="space-y-1">{rows.map((row) => <div key={row.key} className="grid grid-cols-[96px_minmax(0,1fr)_92px] items-center gap-2 text-[11px]">
    <span className="truncate font-mono text-slate-600" title={row.key}>{row.key}</span>
    <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className={cn("block h-full rounded-full", color)} style={{ width: `${(row.count / top) * 100}%` }}/></span>
    <span className="text-right font-mono text-slate-500">{row.count} <span className="text-slate-400">· {((row.count / total) * 100).toFixed(0)} %</span></span>
  </div>)}</div>;
}

/** A right-aligned table header with its "i". */
export function Th({ label, info, className }: { label: string; info?: GlossaryKey; className?: string }) {
  return <Table.ColumnHeaderCell justify="end" className={cn("py-2 text-right font-medium", className)}><span className="inline-flex items-center gap-1">{label}{info && <InfoTip id={info} size="xs"/>}</span></Table.ColumnHeaderCell>;
}

/** The title row of a card: an icon, the title, its "i" and anything on the right. */
export function CardTitle({ icon, title, info, extra, children }: { icon?: React.ReactNode; title: string; info?: GlossaryKey; extra?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
    <p className="flex items-center gap-2 text-sm font-semibold">{icon}{title}{info && <InfoTip id={info}/>}{extra && <span className="font-normal text-slate-400">{extra}</span>}</p>
    {children && <div className="print:hidden">{children}</div>}
  </div>;
}

/** Change against a previous value, coloured by whether it got better. */
export function Delta({ value, previous, unit, lowerIsBetter = true }: { value: number; previous?: number; unit: string; lowerIsBetter?: boolean }) {
  const t = useMessages(MESSAGES);
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null;
  const change = (value - previous) / previous;
  if (Math.abs(change) < 0.05) return <span className="ml-1 text-[10px] text-slate-400">=</span>;
  const better = lowerIsBetter ? change < 0 : change > 0;
  return <span className={cn("ml-1 text-[10px]", better ? "text-emerald-600" : "text-rose-600")} title={t.before(previous, unit)}>{change > 0 ? "▲" : "▼"}{Math.abs(change * 100).toFixed(0)} %</span>;
}

/** A pass/fail pill with its word, so the state is never colour alone. */
export function VerdictPill({ pass, label }: { pass: boolean; label?: string }) {
  const t = useMessages(MESSAGES);
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", pass ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}><span className={cn("size-1.5 rounded-full", pass ? "bg-emerald-500" : "bg-rose-500")}/>{label ?? (pass ? t.pass : t.fail)}</span>;
}
