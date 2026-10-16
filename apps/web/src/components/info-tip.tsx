import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Theme } from "@radix-ui/themes";
import { Info } from "lucide-react";
import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from "@/lib/glossary";
import { GLOSSARY_EN } from "@/lib/glossary-en";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { meaning: (title: string) => `Qué significa: ${title}` },
  en: { meaning: (title: string) => `What it means: ${title}` },
});
import { cn } from "@/lib/utils";

const WIDTH = 320;
const GAP = 8;

/**
 * The "i" next to a metric, a chart, a column or a field: what it is and how to read it.
 *
 * Opens on hover, on keyboard focus and on click (touch has no hover); Escape and a click
 * outside close it. The bubble is rendered in a portal with fixed coordinates, because most of
 * the places it explains — table headers, cards — clip their overflow and would cut it.
 * The trigger stays a tiny structural button (an IconButton would not fit a table header); the
 * bubble is wrapped in a nested Radix `Theme` so the portal keeps the user's theme tokens.
 */
export function InfoTip({ id, className, size = "sm" }: { id: GlossaryKey; className?: string; size?: "sm" | "xs" }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const entry: GlossaryEntry | undefined = (locale === "en" ? GLOSSARY_EN : GLOSSARY)[id];
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleId = useId();

  const place = () => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.min(window.innerWidth - WIDTH - GAP, Math.max(GAP, box.left + box.width / 2 - WIDTH / 2));
    const above = box.bottom + 220 > window.innerHeight && box.top > 240;
    setPosition({ left, top: above ? box.top - GAP : box.bottom + GAP, above });
  };
  const show = () => { place(); setOpen(true); };
  const hide = () => { if (!pinned) setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false); setPinned(false);
    };
    const reposition = () => place();
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  if (!entry) return null;
  return <>
    <button
      ref={buttonRef}
      type="button"
      aria-label={t.meaning(entry.title)}
      aria-describedby={open ? bubbleId : undefined}
      aria-expanded={open}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(event) => { event.stopPropagation(); event.preventDefault(); if (pinned) { setPinned(false); setOpen(false); } else { show(); setPinned(true); } }}
      className={cn("inline-grid shrink-0 place-items-center rounded-full align-middle text-slate-400 outline-none transition-colors hover:text-accent-11 focus-visible:text-accent-11 focus-visible:ring-2 focus-visible:ring-accent-8", open && "text-accent-11", size === "xs" ? "size-3.5" : "size-4", className)}
    >
      <Info className={size === "xs" ? "size-3" : "size-3.5"} aria-hidden/>
    </button>
    {open && position && typeof document !== "undefined" && createPortal(
      <Theme asChild><div id={bubbleId} role="tooltip" style={{ left: position.left, top: position.top, width: WIDTH, transform: position.above ? "translateY(-100%)" : undefined, boxShadow: "var(--shadow-5)" }} className="pointer-events-none fixed z-[100] rounded-[var(--radius-4)] border border-slate-200 bg-panel p-3 text-left normal-case tracking-normal">
        <p className="text-xs font-semibold text-slate-800">{entry.title}</p>
        <p className="mt-1 text-[11px] font-normal leading-5 text-slate-600">{entry.what}</p>
        {entry.read && <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] font-normal leading-5 text-slate-600"><span className="font-semibold text-slate-700">Cómo leerlo: </span>{entry.read}</p>}
      </div></Theme>,
      document.body,
    )}
  </>;
}

/** A label with its "i" beside it. */
export function WithInfo({ id, children, className }: { id: GlossaryKey; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1", className)}>{children}<InfoTip id={id} size="xs"/></span>;
}
