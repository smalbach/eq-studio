import { Button, Spinner } from "@radix-ui/themes";
import { ArrowRight, BookOpen, LayoutGrid } from "lucide-react";
import type { Environment } from "@/components/environment/use-environment";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import { BudgetsGuide } from "@/components/guide/budgets-guide";
import { CredentialsGuide } from "@/components/guide/credentials-guide";
import { EnvironmentGuide } from "@/components/guide/environment-guide";
import { FirstProjectGuide } from "@/components/guide/first-project-guide";
import { FunctionalGuide } from "@/components/guide/functional-guide";
import { NeedsProject } from "@/components/guide/guide-kit";
import { GUIDES, guideById } from "@/components/guide/guides";
import { LoadGuide } from "@/components/guide/load-guide";
import { SyncGuide } from "@/components/guide/sync-guide";
import { useProject } from "@/lib/project-store";
import type { Workspace } from "@/lib/use-workspace";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

export type GuideProps = { workspace: Workspace; env: Environment; guide: string; step: number; crumbs: Crumb[]; onStep: (guide: string, step: number) => void; onDone: (target: "functional" | "load" | "home") => void };

const MESSAGES = defineMessages({
  es: { title: "Guías paso a paso", intro: "Cada guía valida cada paso antes de seguir, muestra un ejemplo al lado y se puede dejar y retomar: el paso queda en la dirección y las respuestas en este navegador.", all: "Todas las guías", docs: "Documentación", steps: (n: number) => `${n} pasos`, needsProject: "necesita un proyecto", loading: "Cargando el proyecto…" },
  en: { title: "Step-by-step guides", intro: "Each guide validates every step before moving on, shows an example beside it and can be left and resumed: the step stays in the address and the answers in this browser.", all: "All guides", docs: "Documentation", steps: (n: number) => `${n} steps`, needsProject: "needs a project", loading: "Loading the project…" },
});

/** The id that shows the list of guides instead of one of them. */
export const ALL_GUIDES = "all";

/**
 * The step-by-step guides: a list to pick from, or one guide at its step. The guide and step
 * come from the URL (`?vista=guia&guia=load&paso=2`) and every step change goes back through
 * `onStep`, so leaving and coming back — or reloading — lands on the same step.
 */
export function GuidePage({ workspace, env, guide, step, crumbs, onStep, onDone }: GuideProps) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const project = useProject();
  const entry = guideById(guide);
  const onboarding = !workspace.projects.length;

  if (!entry) return <div>
    <PageHeader crumbs={crumbs} title={t.title} description={t.intro} actions={<Button asChild size="1" variant="surface" color="gray"><a href="?vista=aprende"><BookOpen className="size-3.5"/>{t.docs}</a></Button>}/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{GUIDES.map((item) => {
      const Icon = item.icon;
      return <button key={item.id} type="button" onClick={() => onStep(item.id, 0)} className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-panel p-4 text-left shadow-sm hover:border-accent-7 hover:bg-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-8">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-3 text-accent-11"><Icon className="size-4"/></span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">{item.title[locale]}<ArrowRight className="size-3.5 text-slate-300 group-hover:text-accent-11"/></span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{item.summary[locale]}</span>
          <span className="mt-2 block text-[10px] text-slate-400">{t.steps(item.steps.length)}{item.needsProject && !project.id ? ` · ${t.needsProject}` : ""}</span>
        </span>
      </button>;
    })}</div>
  </div>;

  const total = entry.steps.length;
  const current = Math.min(Math.max(0, step), total - 1);
  const go = (next: number) => onStep(entry.id, Math.min(Math.max(0, next), total - 1));
  const switchGuide = (id: string) => onStep(id, 0);
  const common = { guide: entry, workspace, env, step: current, onStep: go, onDone };

  let body: React.ReactNode;
  if (entry.id === "first-project") body = <FirstProjectGuide {...common}/>;
  else if (entry.id === "sync") body = <SyncGuide {...common}/>;
  else if (!project.id) body = <NeedsProject onFirstProject={() => switchGuide("first-project")}/>;
  else if (env.loading) body = <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner size="2"/>{t.loading}</p>;
  // Keyed by project: a guide's answers belong to the project they were given for.
  else if (entry.id === "environment") body = <EnvironmentGuide key={project.id} {...common} onGuide={switchGuide}/>;
  else if (entry.id === "credentials") body = <CredentialsGuide key={project.id} {...common} onGuide={switchGuide}/>;
  else if (entry.id === "functional") body = <FunctionalGuide key={project.id} {...common}/>;
  else if (entry.id === "budgets") body = <BudgetsGuide key={project.id} {...common}/>;
  else body = <LoadGuide key={project.id} {...common}/>;

  return <div>
    <PageHeader crumbs={[...crumbs, { label: entry.title[locale] }]} title={entry.title[locale]} description={entry.summary[locale]} actions={!onboarding && <>
      <Button asChild size="1" variant="surface" color="gray"><a href={`?vista=aprende&doc=${entry.doc}`}><BookOpen className="size-3.5"/>{t.docs}</a></Button>
      <Button type="button" size="1" variant="surface" color="gray" onClick={() => switchGuide(ALL_GUIDES)}><LayoutGrid className="size-3.5"/>{t.all}</Button>
    </>}/>
    {body}
  </div>;
}
