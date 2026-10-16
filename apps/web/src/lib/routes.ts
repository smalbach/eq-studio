/**
 * Where the user is, kept in the query string so a reload, a shared link and the browser's back
 * button all land on the same screen.
 *
 * - `section` — the projects (home), one project's dashboard, its functional verification or
 *   load tests, the guides, the documentation or the settings;
 * - `project` — the slug of the project a project screen shows (`?vista=panel&proyecto=store-api`),
 *   so a link opens the same project on any browser;
 * - `page` — inside a section, the list of runs or the screen that starts a new one;
 * - `run` — a run opened from the list. It opens in a panel **over** the list, which stays
 *   mounted underneath: closing it returns to the same scroll position and filters;
 * - `guide` / `step` — the step-by-step guides (`?vista=guia&guia=entorno&paso=2`);
 * - `learn` / `doc` — the documentation (`?vista=aprende&doc=carga`).
 */
export type Section = "home" | "dashboard" | "functional" | "load" | "guide" | "learn" | "settings";
export type Route = { section: Section; project?: string; page?: "runs" | "new"; run?: string; guide?: string; step?: number; doc?: string };

/** The screens that show one project: they carry it in the URL. */
export const PROJECT_SECTIONS: readonly Section[] = ["dashboard", "functional", "load"];
export const isProjectSection = (section: Section) => PROJECT_SECTIONS.includes(section);

const SECTION_PARAM: Record<Section, string> = { home: "inicio", dashboard: "panel", functional: "funcional", load: "carga", guide: "guia", learn: "aprende", settings: "ajustes" };
const PARAM_SECTION = Object.fromEntries(Object.entries(SECTION_PARAM).map(([key, value]) => [value, key])) as Record<string, Section>;

export function routeFromParams(params: { get(name: string): string | null }): Route {
  const section = PARAM_SECTION[params.get("vista") ?? ""] ?? "home";
  const project = params.get("proyecto") ?? undefined;
  if (section === "home" || section === "settings") return { section };
  if (section === "dashboard") return { section, ...(project ? { project } : {}) };
  if (section === "guide") return { section, guide: params.get("guia") ?? "first-project", step: Math.max(0, Number(params.get("paso") ?? 0) || 0) };
  if (section === "learn") return { section, doc: params.get("doc") ?? "inicio" };
  const run = params.get("corrida") ?? undefined;
  return { section, ...(project ? { project } : {}), page: params.get("pagina") === "nueva" && !run ? "new" : "runs", ...(run ? { run } : {}) };
}

export function routeToSearch(route: Route) {
  const params = new URLSearchParams();
  if (route.section !== "home") params.set("vista", SECTION_PARAM[route.section]);
  if (route.project && isProjectSection(route.section)) params.set("proyecto", route.project);
  if (route.section === "guide") { params.set("guia", route.guide ?? "first-project"); if (route.step) params.set("paso", String(route.step)); }
  if (route.section === "learn" && route.doc) params.set("doc", route.doc);
  if (route.page === "new") params.set("pagina", "nueva");
  if (route.run) params.set("corrida", route.run);
  const search = params.toString();
  return search ? `?${search}` : "";
}
