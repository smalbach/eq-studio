import { useState } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { Button, DropdownMenu, Spinner } from "@radix-ui/themes";
import { API, ApiError } from "@/lib/api";
import { download } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    download: "Descargar informe", failed: (detail: string) => `No se pudo generar el informe: ${detail}`,
    html: "HTML", htmlHint: "Una página autocontenida para compartir o imprimir",
    sarif: "SARIF", sarifHint: "Para el escaneo de código de GitHub",
    junit: "JUnit XML", junitHint: "Para la vista de pruebas del CI",
    masked: "Los secretos se enmascaran.",
  },
  en: {
    download: "Download report", failed: (detail: string) => `Could not make the report: ${detail}`,
    html: "HTML", htmlHint: "A self-contained page to share or print",
    sarif: "SARIF", sarifHint: "For GitHub code scanning",
    junit: "JUnit XML", junitHint: "For the CI's test view",
    masked: "Secrets are masked.",
  },
});

const FORMATS = [{ format: "html", extension: "html" }, { format: "sarif", extension: "sarif" }, { format: "junit", extension: "xml" }] as const;

/**
 * The run as a file to share, rendered by the API with the same code as `eq run --html/--sarif/
 * --junit`: one self-contained HTML page, SARIF for code scanning, or JUnit XML.
 */
export function ReportMenu({ runId, name }: { runId: string; name: string }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchReport = async (format: (typeof FORMATS)[number]["format"], extension: string) => {
    setBusy(true);
    setError(null);
    try {
      const { text, type } = await API.runReport(runId, format, locale);
      download(`${name}.${extension}`, text, type);
    } catch (problem) {
      setError(t.failed(problem instanceof ApiError ? problem.message : String(problem)));
    } finally {
      setBusy(false);
    }
  };
  return <span className="inline-flex items-center gap-2 print:hidden">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button size="1" variant="surface" color="gray" disabled={busy}>{busy ? <Spinner size="1"/> : <FileDown className="size-3.5"/>}{t.download}<ChevronDown className="size-3"/></Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end">
        {FORMATS.map(({ format, extension }) => <DropdownMenu.Item key={format} style={{ height: "auto" }} onSelect={() => void fetchReport(format, extension)}>
          <span className="flex flex-col py-0.5"><span className="font-medium">{t[format]}</span><span className="text-[11px] opacity-70">{t[`${format}Hint`]}</span></span>
        </DropdownMenu.Item>)}
        <DropdownMenu.Separator/>
        <DropdownMenu.Label>{t.masked}</DropdownMenu.Label>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    {error && <span role="alert" className="text-[11px] text-rose-600">{error}</span>}
  </span>;
}
