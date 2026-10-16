import { useState } from "react";
import { Button, Popover, Separator, Spinner, Text } from "@radix-ui/themes";
import { Activity, BookOpen, CalendarClock, ChevronDown, FolderOpen, Folders, Gauge, Globe2, LayoutDashboard, Settings, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { AutomationPanel } from "@/components/automation/automation-panel";
import { EnvironmentPanel } from "@/components/environment/environment-panel";
import type { Environment } from "@/components/environment/use-environment";
import { ProjectPanel } from "@/components/projects/project-panel";
import { useProject } from "@/lib/project-store";
import type { Workspace } from "@/lib/use-workspace";
import type { Section } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "@/components/app/appearance";
import { LogoMark } from "@/components/app/logo-mark";
import { LanguageToggle } from "@/components/app/language-toggle";
import { defineMessages, useMessages } from "@/lib/i18n";

type NavItem = { id: Exclude<Section, "guide">; icon: typeof Activity };
// The projects first, then what works on the open one, then what does not depend on a project.
const NAV: NavItem[][] = [[{ id: "home", icon: Folders }], [{ id: "dashboard", icon: LayoutDashboard }, { id: "functional", icon: ShieldCheck }, { id: "load", icon: Gauge }], [{ id: "learn", icon: BookOpen }, { id: "settings", icon: Settings }]];

const MESSAGES = defineMessages({
  es: { home: "Proyectos", dashboard: "Panel", functional: "Verificación funcional", load: "Carga y estrés", learn: "Documentación", settings: "Ajustes", subtitle: "Calidad de APIs contra su contrato", sections: "Secciones", running: "en curso", environment: "Entorno", environmentTitle: "Entorno y lo que permite", project: "Proyecto", projectTitle: "El proyecto abierto y sus acciones", automation: "Automatización", automationTitle: "Programaciones y notificaciones del proyecto", automationDetail: "Programar y avisar" },
  en: { home: "Projects", dashboard: "Dashboard", functional: "Functional verification", load: "Load and stress", learn: "Documentation", settings: "Settings", subtitle: "API quality against its contract", sections: "Sections", running: "running", environment: "Environment", environmentTitle: "Environment and what it allows", project: "Project", projectTitle: "The open project and its actions", automation: "Automation", automationTitle: "The project's schedules and notifications", automationDetail: "Schedule and notify" },
});

/** A header button that opens a settings panel in a popover below it. */
function HeaderMenu({ icon: Icon, caption, title, detail, dot, label, children }: { icon: typeof Activity; caption: string; title: string; detail: string; dot?: { className: string; label: string }; label: string; children: (close: () => void) => React.ReactNode }) {
  // The settings live behind a button: they are set once per session and then only glanced at,
  // and as a card they pushed the work itself below the fold.
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger>
      <Button variant={open ? "solid" : "surface"} color="gray" highContrast={open} size="3" title={label} className="h-auto shrink-0 justify-start px-3 py-1.5 text-left">
        <Icon className="size-4 shrink-0 opacity-60"/>
        <span className="min-w-0"><span className="block text-[10px] font-medium uppercase tracking-wider opacity-60">{caption}</span><span className="block max-w-44 truncate text-xs font-semibold">{title}</span><span className="block max-w-44 truncate font-mono text-[10px] opacity-70">{detail}</span></span>
        {dot && <span title={dot.label} className={cn("size-2 shrink-0 rounded-full", dot.className)}/>}
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}/>
      </Button>
    </Popover.Trigger>
    <Popover.Content align="end" sideOffset={8} aria-label={label} width="min(56rem, calc(100vw - 2rem))" maxWidth="calc(100vw - 2rem)" maxHeight="calc(100vh - 7rem)">
      {children(() => setOpen(false))}
    </Popover.Content>
  </Popover.Root>;
}

/** The header's project button: which API, which contract version, and its actions below it. */
function ProjectMenu({ workspace, busy, onGuide, onSwitch }: { workspace: Workspace; busy: boolean; onGuide: () => void; onSwitch: () => void }) {
  const t = useMessages(MESSAGES);
  const project = useProject();
  const config = project.file.project;
  return <HeaderMenu icon={FolderOpen} caption={t.project} title={config.name} detail={`${config.operations.length} ops${config.contractVersion ? ` · v${config.contractVersion}` : ""}`} label={t.projectTitle}>
    {(close) => <ProjectPanel workspace={workspace} busy={busy} onClose={close} onGuide={() => { close(); onGuide(); }} onSwitch={() => { close(); onSwitch(); }}/>}
  </HeaderMenu>;
}

/** The header's environment button: name, credential state, and the settings below it. */
function EnvironmentMenu({ env, busy }: { env: Environment; busy: boolean }) {
  const t = useMessages(MESSAGES);
  return <HeaderMenu icon={Globe2} caption={t.environment} title={env.label} detail={env.baseUrl} dot={{ className: env.tokenStatus.dot, label: env.tokenStatus.label }} label={t.environmentTitle}>
    {(close) => <EnvironmentPanel env={env} busy={busy} onClose={close}/>}
  </HeaderMenu>;
}

/** The header's automation button: the project's schedules and notification targets below it. */
function AutomationMenu({ env }: { env: Environment }) {
  const t = useMessages(MESSAGES);
  return <HeaderMenu icon={CalendarClock} caption={t.automation} title={t.automationDetail} detail={env.label} label={t.automationTitle}>
    {(close) => <AutomationPanel env={env} onClose={close}/>}
  </HeaderMenu>;
}

/** Logo, the sections (with a spinner where something is running), the open project and its environment. */
export function AppHeader({ section, onSection, onGuide, workspace, env, functionalBusy, loadRunning }: { section: Section; onSection: (section: Section) => void; onGuide: () => void; workspace: Workspace; env: Environment; functionalBusy: boolean; loadRunning: boolean }) {
  const busyIn: Partial<Record<Section, boolean>> = { functional: functionalBusy, load: loadRunning };
  // In a hosted deployment the subtitle says which workspace the screens are showing.
  const session = useSession();
  const workspaceName = session.session?.workspaces.find((item) => item.id === session.workspaceId)?.name;
  const t = useMessages(MESSAGES);
  return <header className="sticky top-0 z-30 print:hidden border-b border-slate-200 bg-white/90 backdrop-blur-xl">
    <div className="mx-auto flex max-w-[1720px] flex-wrap items-center gap-3 px-5 py-3 lg:flex-nowrap lg:gap-5 lg:px-7">
      <button type="button" onClick={() => onSection("home")} className="flex min-w-fit items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-8"><span className="grid size-10 place-items-center rounded-[var(--radius-4)] bg-accent-9 shadow-sm"><LogoMark className="size-7 text-accent-contrast"/></span><span><Text as="span" size="2" weight="bold" className="block tracking-tight">Endpoint Quality</Text><Text as="span" size="1" color="gray" className="block">{workspaceName ?? t.subtitle}</Text></span></button>
      <nav aria-label={t.sections} className="flex flex-1 flex-wrap items-center gap-1">{NAV.map((group, index) => <div key={index} className="flex flex-wrap items-center gap-1">
        {index > 0 && <Separator orientation="vertical" size="1" className="mx-1 hidden sm:block"/>}
        {group.map(({ id, icon: Icon }) => <Button key={id} size="2" variant={section === id ? "soft" : "ghost"} color={section === id ? undefined : "gray"} highContrast={section !== id} onClick={() => onSection(id)} aria-current={section === id ? "page" : undefined} className="mx-0 text-xs font-semibold">
          <Icon className="size-4"/>{t[id]}{busyIn[id] && <Spinner size="1" aria-label={t.running}/>}
        </Button>)}
      </div>)}</nav>
      <LanguageToggle/>
      <AppearanceMenu/>
      {workspace.activeId && <ProjectMenu workspace={workspace} busy={functionalBusy || loadRunning} onGuide={onGuide} onSwitch={() => onSection("home")}/>}
      {workspace.activeId && <EnvironmentMenu env={env} busy={functionalBusy || loadRunning}/>}
      {workspace.activeId && <AutomationMenu env={env}/>}
    </div>
  </header>;
}
