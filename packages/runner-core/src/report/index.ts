/**
 * Shareable reports of a run: a self-contained HTML page, SARIF 2.1.0 for code scanning and
 * JUnit XML for test views. Shared by the CLI (`eq run --html/--sarif/--junit`, `eq report`) and
 * the API (`GET /v1/runs/:id/report`). Every renderer masks the run's secrets first.
 */
import { htmlReport } from "./html.ts";
import { junitReport } from "./junit.ts";
import type { ReportContext, ReportRun } from "./model.ts";
import { sarifReport } from "./sarif.ts";

export * from "./model.ts";
export { MASK, maskSecrets, maskText } from "./mask.ts";
export { htmlReport } from "./html.ts";
export { junitReport } from "./junit.ts";
export { sarifReport, SARIF_SCHEMA, type SarifLog } from "./sarif.ts";

export const REPORT_FORMATS = ["html", "sarif", "junit"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** A report in one format: its text, media type and file extension. */
export function renderReport(format: ReportFormat, run: ReportRun, context: ReportContext) {
  switch (format) {
    case "html": return { body: htmlReport(run, context), contentType: "text/html; charset=utf-8", extension: "html" };
    case "sarif": return { body: `${JSON.stringify(sarifReport(run, context), null, 2)}\n`, contentType: "application/sarif+json; charset=utf-8", extension: "sarif" };
    case "junit": return { body: junitReport(run, context), contentType: "application/xml; charset=utf-8", extension: "xml" };
  }
}
