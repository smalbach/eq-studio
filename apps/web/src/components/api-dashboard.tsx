import { useEffect, useState } from "react";
import { Button, Spinner } from "@radix-ui/themes";
import { CircleAlert } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { useEnvironment } from "@/components/environment/use-environment";
import { useFunctionalRunner } from "@/components/functional/use-functional-runner";
import { useWorkbench } from "@/components/functional/workbench/use-workbench";
import { FunctionalRunsPage } from "@/components/functional/runs-page";
import { NewRunPage } from "@/components/functional/workbench/new-run-page";
import { useLoadRunner } from "@/components/load/use-load-runner";
import { LoadRunsPage, NewLoadPage } from "@/components/load/load-pages";
import { OverviewPage } from "@/components/overview/overview-page";
import { ProjectsPage } from "@/components/projects/projects-page";
import { GuidePage } from "@/components/guide/guide-page";
import { clearGuideDraft } from "@/components/guide/guide-kit";
import { LearnPage } from "@/components/learn/learn-page";
import { SettingsPage } from "@/components/account/settings-page";
import type { Crumb } from "@/components/common/page-header";
import { useRoute, type Route, type Section } from "@/lib/navigation";
import { isProjectSection } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/api";
import { usePersistedSettings } from "@/lib/use-persisted-settings";
import { useProject } from "@/lib/project-store";
import { useWorkspace } from "@/lib/use-workspace";
import { resolveCase, splitCaseKey } from "@/lib/run-entries";
import { PrintStamp } from "@/components/common/print-button";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { functional: "Verificación funcional", load: "Carga y estrés", learn: "Documentación", guide: "Guía", settings: "Ajustes", home: "Proyectos", newRun: "Nueva ejecución", newTest: "Nueva prueba", report: "Reporte", dashboard: "Panel de control", generated: "generado", loading: "Cargando…", unreachable: "No se pudo conectar con el API de Endpoint Quality", unreachableHint: "Arráncalo con «npx endpoint-quality serve» (o «pnpm run dev» desde el repositorio) y recarga esta página.", retry: "Reintentar" },
  en: { functional: "Functional verification", load: "Load and stress", learn: "Documentation", guide: "Guide", settings: "Settings", home: "Projects", newRun: "New run", newTest: "New test", report: "Report", dashboard: "Dashboard", generated: "generated", loading: "Loading…", unreachable: "Could not reach the Endpoint Quality API", unreachableHint: "Start it with \"npx endpoint-quality serve\" (or \"pnpm run dev\" from the repository), then reload this page.", retry: "Retry" },
});

/**
 * The shell: where the user is, and the state every screen shares.
 *
 * The workspace (projects, read from the API), the environment, the functional runner, the
 * verification selection and the load runner all live here, above the screens, so a run keeps
 * being followed — and its selection keeps moving — while the user moves between screens.
 *
 * Home is the list of projects; entering one opens its dashboard, and its screens (dashboard,
 * functional, load) carry the project's slug in the URL. With no project yet, the new-project
 * guide is the only screen.
 */
export function ApiDashboard({ initialRoute = { section: "home" } }: { initialRoute?: Route }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const { route, navigate, back } = useRoute(initialRoute);
  const workspace = useWorkspace();
  const project = useProject();
  const env = useEnvironment();
  const runner = useFunctionalRunner(env);
  const bench = useWorkbench(env.authEnabled);
  const load = useLoadRunner({ environmentId: env.environmentId, baseUrl: env.baseUrl, environmentName: env.label, environments: env.environments, remote: !env.seeded });
  // What is configuration rather than a result, per project: order, selection, delay, samples.
  usePersistedSettings(`dashboard:${project.id || "none"}`, { ...bench.snapshot, workbenchProject: project.id, ...runner.snapshot }, (saved) => { bench.restore(saved); runner.restore(saved); }, { credentials: false, secrets: false });

  const go = (section: Section, page?: Route["page"], run?: string) => {
    if (!isProjectSection(section)) { navigate({ section }); return; }
    const projectSlug = project.slug || undefined;
    navigate(section === "dashboard" ? { section, project: projectSlug } : { section, project: projectSlug, page: page ?? "runs", ...(run ? { run } : {}) });
  };
  /** Opens a project from the list: its dashboard. */
  const enter = (summary: ProjectSummary) => { workspace.open(summary.id); navigate({ section: "dashboard", project: summary.slug }); };
  const crumbs = (section: Exclude<Section, "home">, current?: string): Crumb[] => [
    { label: t.home, onClick: () => go("home") },
    ...(isProjectSection(section) ? [{ label: project.file.project.name, onClick: section !== "dashboard" ? () => go("dashboard") : undefined }] : []),
    ...(section === "dashboard" ? [] : [{ label: t[section], onClick: current ? () => go(section) : undefined }]),
    ...(current ? [{ label: current }] : []),
  ];

  // The project in the URL is the one the project screens show: a link or a reload opens it.
  const wanted = isProjectSection(route.section) ? route.project : undefined;
  const { open: openProject, projects, activeId } = workspace;
  useEffect(() => {
    if (!projects.length) return;
    if (!wanted) {
      // An older link without the project: name the open one, so the URL can be shared.
      const current = projects.find((item) => item.id === activeId);
      if (isProjectSection(route.section) && current) navigate({ ...route, project: current.slug }, { replace: true });
      return;
    }
    const match = projects.find((item) => item.slug === wanted || item.id === wanted);
    if (!match) navigate({ section: "home" }, { replace: true });
    else if (match.id !== activeId) openProject(match.id);
  }, [wanted, projects, activeId, openProject, route, navigate]);
  const closeRun = (section: "functional" | "load") => back({ section, page: "runs" });
  const rerunCase = (endpointId: string, scenarioId: string) => { bench.openCase(endpointId, scenarioId); go("functional", "new"); };
  /** Runs the given cases again as a new run, and moves to its monitor. */
  const rerunCases = (keys: string[], scope: string) => {
    const items = keys.map((key) => { const { endpointId, scenarioId } = splitCaseKey(key); return resolveCase(endpointId, scenarioId, locale); }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!items.length || runner.busy) return;
    void runner.run(items, { scope, onCaseStart: ({ endpoint, scenario }) => bench.followCase(endpoint.id, scenario.id) });
    go("functional", "new");
  };
  const guide = (name: string, step = 0) => navigate({ section: "guide", guide: name, step });
  // The project guide keeps its answers to be resumed: a new project starts it over, remounted.
  const [fresh, setFresh] = useState(0);
  const newProject = () => { clearGuideDraft("first-project"); setFresh((value) => value + 1); guide("first-project"); };

  if (workspace.error && !workspace.projects.length) return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground"><div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800"><p className="flex items-center gap-2 font-semibold"><CircleAlert className="size-5"/>{t.unreachable}</p><p className="mt-2 text-sm">{t.unreachableHint}</p><Button type="button" size="2" variant="solid" color="red" onClick={() => { void workspace.refresh(); }} className="mt-4">{t.retry}</Button></div></main>;
  if (workspace.loading && !project.id) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><p className="flex items-center gap-2 text-sm text-slate-500"><Spinner size="2"/>{t.loading}</p></main>;
  // No project yet: the first-project guide is the way in.
  const onboarding = !workspace.projects.length;
  // The documentation stays reachable: reading it first is a reasonable way in too.
  const section: Section = onboarding && route.section !== "learn" && route.section !== "settings" ? "guide" : route.section;

  return <main className="min-h-screen bg-background text-foreground">
    <AppHeader section={section} onSection={(next) => go(next)} onGuide={() => guide("all")} workspace={workspace} env={env} functionalBusy={Boolean(runner.busy)} loadRunning={load.running}/>
    <div className="mx-auto max-w-[1720px] px-5 py-6 lg:px-7 print:max-w-none print:p-0">
      <div data-print-keep className="mb-4 hidden border-b border-slate-300 pb-2 print:block"><p className="text-base font-bold">{project.file.project.name} · {t.report}</p><p className="text-[11px] text-slate-500">{t[section]} · {env.label} ({env.baseUrl}) · {t.generated} <PrintStamp/></p></div>
      {section === "guide" && <GuidePage key={fresh} workspace={workspace} env={env} guide={onboarding ? "first-project" : route.guide ?? "first-project"} step={route.step ?? 0} crumbs={crumbs("guide")} onStep={(name, step) => navigate({ section: "guide", guide: name, step }, { replace: true })} onDone={(target) => go(target === "home" ? "dashboard" : target)}/>}
      {section === "settings" && <SettingsPage crumbs={crumbs("settings")}/>}
      {section === "learn" && <LearnPage doc={route.doc ?? "inicio"} crumbs={crumbs("learn")} onDoc={(doc) => navigate({ section: "learn", doc })} onGuide={(name) => guide(name)}/>}
      {section === "home" && <ProjectsPage workspace={workspace} busy={Boolean(runner.busy) || load.running} now={env.now} onEnter={enter} onNewProject={newProject}/>}
      {section === "dashboard" && <OverviewPage crumbs={crumbs("dashboard")} runner={runner} load={load} now={env.now} actions={{
        openFunctional: () => go("functional"), newFunctional: () => go("functional", "new"), openFunctionalRun: (id) => go("functional", "runs", id),
        openLoad: () => go("load"), newLoad: () => go("load", "new"), openLoadRun: (id) => go("load", "runs", id),
      }}/>}
      {section === "functional" && (route.page === "new"
        ? <NewRunPage env={env} runner={runner} bench={bench} crumbs={crumbs("functional", t.newRun)} onOpenRun={(id) => go("functional", "runs", id)}/>
        : <FunctionalRunsPage runner={runner} crumbs={crumbs("functional")} openRunId={route.run} now={env.now} onOpenRun={(id) => go("functional", "runs", id)} onCloseRun={() => closeRun("functional")} onNewRun={() => go("functional", "new")} onRerunCase={rerunCase} onRerunFailed={rerunCases}/>)}
      {section === "load" && (route.page === "new"
        ? <NewLoadPage load={load} crumbs={crumbs("load", t.newTest)} shared={env.shared} tokenMinutesLeft={env.tokenMinutesLeft} onOpenRun={(id) => go("load", "runs", id)}/>
        : <LoadRunsPage load={load} crumbs={crumbs("load")} openRunId={route.run} now={env.now} onOpenRun={(id) => go("load", "runs", id)} onCloseRun={() => closeRun("load")} onNewRun={() => go("load", "new")}/>)}
    </div>
  </main>;
}
