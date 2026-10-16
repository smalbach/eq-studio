import { Heading, Link, Text } from "@radix-ui/themes";
import { ChevronRight } from "lucide-react";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({ es: { path: "Ruta" }, en: { path: "Breadcrumb" } });

export type Crumb = { label: string; onClick?: () => void };

/** The title of a screen, the path that led to it and its main actions. */
export function PageHeader({ crumbs, title, description, actions }: { crumbs?: Crumb[]; title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  const t = useMessages(MESSAGES);
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      {crumbs && crumbs.length > 0 && <nav aria-label={t.path} className="mb-1 print:hidden flex flex-wrap items-center gap-1 text-[11px] text-slate-500">{crumbs.map((crumb, index) => <span key={crumb.label} className="flex items-center gap-1">
        {index > 0 && <ChevronRight className="size-3 text-slate-300"/>}
        {crumb.onClick ? <Link asChild size="1" color="gray" underline="hover"><button type="button" onClick={crumb.onClick}>{crumb.label}</button></Link> : <Text size="1" className="text-slate-700">{crumb.label}</Text>}
      </span>)}</nav>}
      <Heading as="h1" size="6" weight="bold" className="tracking-tight">{title}</Heading>
      {description && <Text as="p" size="1" color="gray" className="mt-1 max-w-3xl leading-5">{description}</Text>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
  </div>;
}

