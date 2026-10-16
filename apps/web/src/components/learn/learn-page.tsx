import { useMemo } from "react";
import { Button, Callout } from "@radix-ui/themes";
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Info } from "lucide-react";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { GUIDES } from "@/components/guide/guides";
import { DOC_GROUPS, DOCS, docSource } from "@/components/learn/docs";
import { Markdown, parseMarkdown } from "@/components/learn/markdown";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

export type LearnProps = { doc: string; crumbs: Crumb[]; onDoc: (doc: string) => void; onGuide: (guide: string) => void };

const MESSAGES = defineMessages({
  es: { topics: "Temas", onPage: "En esta página", related: "Guías paso a paso relacionadas", previous: "Anterior", next: "Siguiente", missing: (doc: string) => `No hay una página «${doc}»: se muestra el inicio rápido.` },
  en: { topics: "Topics", onPage: "On this page", related: "Related step-by-step guides", previous: "Previous", next: "Next", missing: (doc: string) => `There is no "${doc}" page: showing the quick start instead.` },
});

/**
 * The documentation: a sidebar of topics, the page in the active language and, under it, the
 * guides that put the page into practice. The page is in the URL (`?vista=aprende&doc=carga`),
 * so a link to a topic can be shared.
 */
export function LearnPage({ doc, crumbs, onDoc, onGuide }: LearnProps) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const entry = DOCS.find((item) => item.id === doc) ?? DOCS[0];
  const blocks = useMemo(() => parseMarkdown(docSource(entry.id, locale)), [entry.id, locale]);
  const sections = blocks.filter((block) => block.kind === "heading" && block.level === 2) as { id: string; text: string }[];
  const position = DOCS.indexOf(entry);
  const previous = DOCS[position - 1];
  const next = DOCS[position + 1];
  const related = entry.guides.map((id) => GUIDES.find((guide) => guide.id === id)).filter((guide) => guide !== undefined);
  const links = { onDoc, onGuide };

  return <div>
    <PageHeader crumbs={[...crumbs, { label: entry.title[locale] }]} title={entry.title[locale]} description={entry.summary[locale]}/>
    {entry.id !== doc && <Callout.Root size="1" color="amber" className="mb-4"><Callout.Icon><Info className="size-4"/></Callout.Icon><Callout.Text>{t.missing(doc)}</Callout.Text></Callout.Root>}
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_200px]">
      <nav aria-label={t.topics} className="print:hidden lg:sticky lg:top-20 lg:self-start">
        {DOC_GROUPS.map((group) => <div key={group.id} className="mb-4">
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.label[locale]}</p>
          <ul className="space-y-0.5">{DOCS.filter((item) => item.group === group.id).map((item) => <li key={item.id}>
            <a href={`?vista=aprende&doc=${item.id}`} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onDoc(item.id); }} aria-current={item.id === entry.id ? "page" : undefined} className={cn("flex items-center justify-between gap-2 rounded-[var(--radius-3)] px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent-8", item.id === entry.id ? "bg-accent-3 font-semibold text-accent-12" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
              {item.title[locale]}
            </a>
          </li>)}</ul>
        </div>)}
      </nav>

      <div className="min-w-0">
        <Card className="px-6 py-6 sm:px-8"><Markdown blocks={blocks} links={links}/></Card>

        {related.length > 0 && <section className="mt-5 print:hidden">
          <h2 className="mb-2 text-xs font-semibold text-slate-500">{t.related}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{related.map((guide) => {
            const Icon = guide.icon;
            return <button key={guide.id} type="button" onClick={() => onGuide(guide.id)} className="group flex items-start gap-3 rounded-[var(--radius-4)] border border-slate-200 bg-panel p-3 text-left shadow-sm outline-none hover:border-accent-7 hover:bg-accent-2 focus-visible:ring-2 focus-visible:ring-accent-8">
              <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-3)] bg-accent-3 text-accent-11"><Icon className="size-4"/></span>
              <span className="min-w-0"><span className="flex items-center gap-1 text-xs font-semibold text-slate-900">{guide.title[locale]}<ChevronRight className="size-3 text-slate-400 group-hover:text-accent-11"/></span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{guide.summary[locale]}</span></span>
            </button>;
          })}</div>
        </section>}

        <div className="mt-5 flex justify-between gap-3 print:hidden">
          {previous ? <Button type="button" size="1" variant="surface" color="gray" onClick={() => onDoc(previous.id)}><ArrowLeft className="size-3.5"/>{t.previous}: {previous.title[locale]}</Button> : <span/>}
          {next && <Button type="button" size="1" variant="surface" color="gray" onClick={() => onDoc(next.id)}>{t.next}: {next.title[locale]}<ArrowRight className="size-3.5"/></Button>}
        </div>
      </div>

      {sections.length > 1 && <aside aria-label={t.onPage} className="hidden xl:sticky xl:top-20 xl:block xl:self-start print:hidden">
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><BookOpen className="size-3"/>{t.onPage}</p>
        <ul className="space-y-1 border-l border-slate-200">{sections.map((section) => <li key={section.id}>
          <a href={`#${section.id}`} onClick={(event) => { event.preventDefault(); document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="-ml-px block border-l border-transparent pl-3 text-[11px] leading-4 text-slate-500 hover:border-accent-9 hover:text-slate-900">{section.text.replace(/[`*]/g, "")}</a>
        </li>)}</ul>
      </aside>}
    </div>
  </div>;
}
