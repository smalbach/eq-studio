import { useEffect, useState } from "react";
import { Button } from "@radix-ui/themes";
import { Printer } from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { print: "Imprimir", printTitle: "Imprimir o guardar como PDF" },
  en: { print: "Print", printTitle: "Print or save as PDF" },
});

/**
 * Prints what is on screen as a report: the print stylesheet in `app/globals.css` drops the
 * controls, forces the light palette and, with a run open, prints only its panel. "Guardar como
 * PDF" in the browser's dialog turns it into a file.
 */
export function PrintButton({ label, className }: { label?: string; className?: string }) {
  const t = useMessages(MESSAGES);
  return <Button size="1" variant="surface" color="gray" onClick={() => window.print()} title={t.printTitle} className={cn("print:hidden", className)}><Printer className="size-3.5"/>{label ?? t.print}</Button>;
}

/** The moment the page was printed, set when the print dialog opens — never at render, so it
 * neither mismatches the server's clock on hydration nor goes stale on a page left open. */
export function PrintStamp() {
  const locale = useLocale();
  const [stamp, setStamp] = useState("");
  useEffect(() => {
    const onPrint = () => setStamp(formatDate(Date.now(), locale));
    window.addEventListener("beforeprint", onPrint);
    return () => window.removeEventListener("beforeprint", onPrint);
  }, [locale]);
  return <span>{stamp}</span>;
}
