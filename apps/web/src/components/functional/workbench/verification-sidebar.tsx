import { Callout } from "@radix-ui/themes";
import { Check, CircleAlert, Database, ShieldCheck, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Environment } from "@/components/environment/use-environment";
import type { Endpoint } from "@/lib/endpoints";
import type { RunResult } from "@/lib/run-types";
import { cn } from "@/lib/utils";
import { useProject } from "@/lib/project-store";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    checks: "Verificaciones",
    checksEmpty: "Los checks de estado, estructura, contenido y tiempo aparecerán después de ejecutar.",
    specification: "Especificación",
    public: "Público",
    protected: "Requiere credencial",
    customTitle: "Entorno personalizado",
    localNote: "Entorno con la semilla del proyecto. Los flujos de escritura borran lo que crean y verifican la persistencia.",
    sharedNote: "Entorno compartido: la matriz completa escribe y borra datos reales. Empieza por la Matriz GET.",
    readOnlyNote: "Entorno de solo lectura: los casos de escritura no se envían.",
    targetNote: (url: string) => `Apuntando a ${url}. Revisa el entorno antes de ejecutar escrituras.`,
  },
  en: {
    checks: "Checks",
    checksEmpty: "The status, structure, content and timing checks appear after a run.",
    specification: "Specification",
    public: "Public",
    protected: "Needs a credential",
    customTitle: "Custom environment",
    localNote: "Environment with the project's seed. Write flows delete what they create and verify persistence.",
    sharedNote: "Shared environment: the full matrix writes and deletes real data. Start with the GET matrix.",
    readOnlyNote: "Read-only environment: write cases are not sent.",
    targetNote: (url: string) => `Pointing at ${url}. Review the environment before running writes.`,
  },
});

function Assertions({ current }: { current?: RunResult }) {
  const t = useMessages(MESSAGES);
  return <Card className="p-5 shadow-none">
    <div className="mb-4 flex items-center justify-between"><p className="text-sm font-semibold">{t.checks}</p><ShieldCheck className="size-5 text-slate-300"/></div>
    {current ? <div className="space-y-3">{current.assertions.map((assertion) => <div key={assertion.label} className="flex gap-3">
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", assertion.pass ? "bg-emerald-100 text-emerald-600" : assertion.informative ? "bg-amber-100 text-amber-600" : "bg-rose-100 text-rose-600")}>{assertion.pass ? <Check className="size-3"/> : assertion.informative ? <CircleAlert className="size-3"/> : <X className="size-3"/>}</span>
      <div><p className="text-xs font-medium">{assertion.label}</p><p className="mt-0.5 text-[11px] text-slate-400">{assertion.detail}</p></div>
    </div>)}</div> : <p className="text-xs leading-5 text-slate-400">{t.checksEmpty}</p>}
  </Card>;
}

function Specification({ endpoint }: { endpoint: Endpoint }) {
  const t = useMessages(MESSAGES);
  const isPublic = useProject().file.project.auth?.publicOperations?.includes(endpoint.id) ?? false;
  const rows: [string, React.ReactNode, string?][] = [
    ["Tag", endpoint.tag],
    ["operationId", endpoint.id, "truncate font-mono"],
    ["Envelope", endpoint.responseShape, "max-w-40 font-mono text-[10px]"],
    ["Auth", isPublic ? t.public : t.protected],
  ];
  return <Card className="p-5 shadow-none">
    <div className="mb-4 flex items-center gap-2"><Database className="size-4 text-slate-400"/><p className="text-sm font-semibold">{t.specification}</p></div>
    <dl className="space-y-3 text-xs">{rows.map(([label, value, className]) => <div key={label} className="flex justify-between gap-3"><dt className="text-slate-400">{label}</dt><dd className={cn("text-right font-medium", className)}>{value}</dd></div>)}</dl>
  </Card>;
}

function EnvironmentNote({ env }: { env: Environment }) {
  const t = useMessages(MESSAGES);
  const note = !env.writesAllowed ? t.readOnlyNote : env.seeded ? t.localNote : env.active ? t.sharedNote : t.targetNote(env.baseUrl);
  return <Callout.Root size="2" color="amber"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text size="1">
    <span className="block font-semibold">{env.active ? env.label : t.customTitle}</span>
    <span className="mt-1 block text-[11px] leading-5">{note}</span>
  </Callout.Text></Callout.Root>;
}

/** The checks of the last response, the endpoint's contract and a word about the target. */
export function VerificationSidebar({ current, endpoint, env }: { current?: RunResult; endpoint: Endpoint; env: Environment }) {
  return <aside className="space-y-5"><Assertions current={current}/><Specification endpoint={endpoint}/><EnvironmentNote env={env}/></aside>;
}
