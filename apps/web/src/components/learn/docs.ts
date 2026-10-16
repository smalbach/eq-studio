/**
 * The documentation pages: their order, their group in the sidebar, and the guide each one leads
 * to. The text itself lives in `src/content/docs/<locale>/<id>.md`, one file per language, so a
 * writer edits Markdown and never touches a component.
 */
import type { Locale } from "@/lib/i18n";
import type { GuideId } from "@/components/guide/guides";

export type DocGroup = "start" | "guides" | "reference";
export type DocEntry = { id: string; group: DocGroup; title: { es: string; en: string }; summary: { es: string; en: string }; guides: GuideId[] };

export const DOCS: DocEntry[] = [
  { id: "inicio", group: "start", title: { es: "Inicio rápido", en: "Quick start" }, summary: { es: "De cero a una corrida verde en cinco minutos, sin cuenta ni red.", en: "From nothing to a green run in five minutes, with no account and no network." }, guides: ["first-project"] },
  { id: "conceptos", group: "start", title: { es: "Conceptos", en: "Concepts" }, summary: { es: "Proyecto, contrato, entorno, credencial, caso, flujo, presupuesto y perfil de carga.", en: "Project, contract, environment, credential, case, flow, budget and load profile." }, guides: ["first-project", "environment"] },
  { id: "funcional", group: "guides", title: { es: "Verificación funcional", en: "Functional verification" }, summary: { es: "Qué comprueba cada caso generado, la matriz de autenticación y los flujos encadenados.", en: "What each generated case checks, the authentication matrix and chained flows." }, guides: ["functional", "credentials", "budgets"] },
  { id: "carga", group: "guides", title: { es: "Carga y estrés", en: "Load and stress" }, summary: { es: "Modelo abierto, los cuatro tipos de prueba, mezclas, datos y criterios de veredicto.", en: "Open model, the four test types, mixes, data and verdict criteria." }, guides: ["load"] },
  { id: "automatizacion", group: "guides", title: { es: "Programaciones y notificaciones", en: "Schedules and notifications" }, summary: { es: "Corridas que el API lanza solo con cron, y avisos por webhook firmado, Slack o email cuando cambia el veredicto.", en: "Runs the API starts on its own with cron, and alerts by signed webhook, Slack or email when the verdict changes." }, guides: ["functional", "load"] },
  { id: "formato", group: "reference", title: { es: "Formato .eq.json", en: ".eq.json format" }, summary: { es: "Cada campo del archivo de proyecto, con un ejemplo breve.", en: "Every field of the project file, with a short example." }, guides: ["functional", "budgets"] },
  { id: "api", group: "reference", title: { es: "API REST", en: "REST API" }, summary: { es: "Los endpoints del API y cómo usarlos desde scripts y CI.", en: "The API's endpoints and how to use them from scripts and CI." }, guides: ["first-project"] },
  { id: "problemas", group: "reference", title: { es: "Solución de problemas", en: "Troubleshooting" }, summary: { es: "API inalcanzable, TLS, VPN, 401 contra 403, latencia a través de la red, Windows.", en: "Unreachable API, TLS, VPN, 401 versus 403, latency across the network, Windows." }, guides: ["environment", "credentials"] },
  { id: "cli", group: "reference", title: { es: "CLI y CI", en: "CLI and CI" }, summary: { es: "«eq»: el servidor local, corridas con exit code para CI, reportes JUnit y binarios por sistema.", en: "\"eq\": the local server, runs with an exit code for CI, JUnit reports and per-platform binaries." }, guides: ["first-project"] },
  { id: "sync", group: "guides", title: { es: "Sincronización", en: "Sync" }, summary: { es: "El mismo proyecto en varios equipos: merge por campo, conflictos visibles y secretos que no salen del tuyo.", en: "The same project on several machines: field-by-field merges, visible conflicts and secrets that stay on yours." }, guides: ["sync"] },
  { id: "deploy", group: "reference", title: { es: "Despliegue en la nube", en: "Cloud deployment" }, summary: { es: "Docker, cuentas, roles y tokens de API para CI.", en: "Docker, accounts, roles and API tokens for CI." }, guides: ["first-project"] },
];

export const DOC_GROUPS: { id: DocGroup; label: { es: string; en: string } }[] = [
  { id: "start", label: { es: "Empezar", en: "Get started" } },
  { id: "guides", label: { es: "Guías", en: "Guides" } },
  { id: "reference", label: { es: "Referencia", en: "Reference" } },
];

// Bundled as plain strings at build time: the pages work offline and need no request.
const SOURCES = import.meta.glob("../../content/docs/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The page's Markdown in the language asked for, or in Spanish if that one is missing. */
export function docSource(id: string, locale: Locale): string {
  return SOURCES[`../../content/docs/${locale}/${id}.md`] ?? SOURCES[`../../content/docs/es/${id}.md`] ?? "";
}
