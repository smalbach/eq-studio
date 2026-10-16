import { useEffect, useRef } from "react";
import { Button } from "@radix-ui/themes";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/common/print-button";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({ es: { back: "Volver", detail: "Detalle" }, en: { back: "Back", detail: "Detail" } });

/**
 * A run opened from a list: a wide panel that slides over the list instead of replacing it.
 * The list stays mounted underneath with its scroll and filters, and the page behind it does
 * not scroll while the panel is open, so "Volver" lands exactly where the user was.
 */
export function SidePanel({ open, title, subtitle, onClose, actions, children, backLabel: backLabelProp }: { open: boolean; title: React.ReactNode; subtitle?: React.ReactNode; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode; backLabel?: string }) {
  const t = useMessages(MESSAGES);
  const backLabel = backLabelProp ?? t.back;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("[role=tooltip]")) onClose(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    // While a panel is open, printing prints the panel alone (see the print rules in globals.css).
    document.documentElement.dataset.printPanel = "";
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); delete document.documentElement.dataset.printPanel; };
  }, [open, onClose]);
  if (!open) return null;
  return <div data-print-root className="fixed inset-0 z-40">
    <button type="button" aria-label={backLabel} tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-slate-900/30 backdrop-blur-[1px]"/>
    <section role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : t.detail} className={cn("absolute inset-y-0 right-0 flex w-full max-w-[1280px] flex-col bg-background shadow-2xl shadow-slate-900/20 panel-in")}>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3 print:border-0 print:px-0">
        <Button ref={closeRef} type="button" size="1" variant="surface" color="gray" onClick={onClose} className="print:hidden"><ArrowLeft className="size-3.5"/>{backLabel}</Button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{title}</p>{subtitle && <p className="truncate text-[11px] text-slate-500">{subtitle}</p>}</div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}<PrintButton/></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </section>
  </div>;
}
