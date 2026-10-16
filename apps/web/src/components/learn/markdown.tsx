import type { ReactNode } from "react";
import { Callout, Code, Link, Table } from "@radix-ui/themes";
import { ExternalLink } from "lucide-react";

/**
 * A small Markdown renderer for the documentation pages.
 *
 * The pages are our own static text, but they are still rendered as React elements and never
 * as HTML: there is no `dangerouslySetInnerHTML` anywhere, so a stray `<tag>` in a page is shown
 * as the text it is. It supports exactly what the pages use — headings, paragraphs, lists,
 * fenced code, tables, a callout (`>`) and inline code, bold, emphasis and links — which keeps
 * it a page long instead of pulling a parser and a sanitizer into the bundle.
 *
 * Links have three kinds of target: `doc:<id>` (another page), `guide:<id>` (a step-by-step
 * guide) and `http(s)://` (outside the app). The first two are real links to the app's own URL,
 * so they open in a new tab with a modifier key, and a plain click navigates inside the app.
 */
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

/** A heading's anchor: lowercase, no accents, words joined by dashes. */
export const slugOf = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[`*]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The cells of a table row; `\|` is a literal bar inside a cell. */
const cellsOf = (line: string) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  const special = (line: string) => /^(#{1,3}\s|```|>|\||[-*]\s|\d+\.\s|---+\s*$)/.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) { body.push(lines[index]); index += 1; }
      blocks.push({ kind: "code", lang: fence[1], text: body.join("\n") });
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim(), id: slugOf(heading[2]) });
      index += 1;
      continue;
    }
    if (/^---+\s*$/.test(line)) { blocks.push({ kind: "rule" }); index += 1; continue; }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith("|")) { rows.push(cellsOf(lines[index])); index += 1; }
      // The second row is the `| --- |` separator.
      const [head = [], , ...body] = rows;
      blocks.push({ kind: "table", head, rows: body });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) { body.push(lines[index].replace(/^>\s?/, "")); index += 1; }
      blocks.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    const item = /^([-*]|\d+\.)\s+/;
    if (item.test(line)) {
      const ordered = /^\d/.test(line);
      const items: string[] = [];
      while (index < lines.length && (item.test(lines[index]) || (/^\s{2,}\S/.test(lines[index]) && items.length))) {
        // An indented line continues the item above it.
        if (item.test(lines[index])) items.push(lines[index].replace(item, ""));
        else items[items.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() && !special(lines[index])) { body.push(lines[index].trim()); index += 1; }
    blocks.push({ kind: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

export type LinkHandlers = { onDoc: (doc: string) => void; onGuide: (guide: string) => void };

/** A link inside the app: a real URL for a new tab, an in-app navigation for a plain click. */
function AppLink({ href, onOpen, children }: { href: string; onOpen: () => void; children: ReactNode }) {
  return <Link href={href} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpen();
  }} weight="medium" underline="always">{children}</Link>;
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*?)\*/g;

/** Inline code, bold, emphasis and links. Everything else is text. */
export function Inline({ text, links }: { text: string; links: LinkHandlers }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const key = `${at}`;
    const [, code, bold, label, href, emphasis] = match;
    if (code !== undefined) parts.push(<Code key={key} variant="soft" color="gray">{code}</Code>);
    else if (bold !== undefined) parts.push(<strong key={key} className="font-semibold text-slate-900"><Inline text={bold} links={links}/></strong>);
    else if (emphasis !== undefined) parts.push(<em key={key}>{emphasis}</em>);
    else if (href?.startsWith("doc:")) { const doc = href.slice(4); parts.push(<AppLink key={key} href={`?vista=aprende&doc=${encodeURIComponent(doc)}`} onOpen={() => links.onDoc(doc)}><Inline text={label} links={links}/></AppLink>); }
    else if (href?.startsWith("guide:")) { const guide = href.slice(6); parts.push(<AppLink key={key} href={`?vista=guia&guia=${encodeURIComponent(guide)}`} onOpen={() => links.onGuide(guide)}><Inline text={label} links={links}/></AppLink>); }
    else if (href && /^https?:\/\//.test(href)) parts.push(<Link key={key} href={href} target="_blank" rel="noreferrer" weight="medium" underline="always" className="inline-flex items-center gap-0.5">{label}<ExternalLink className="size-3"/></Link>);
    else if (href?.startsWith("#")) parts.push(<Link key={key} href={href} weight="medium" underline="always">{label}</Link>);
    // Any other target is not a link this app knows how to follow: its label stays as text.
    else parts.push(label);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** The page body. The first `#` heading is the page title and is left to the page header. */
export function Markdown({ blocks, links }: { blocks: Block[]; links: LinkHandlers }) {
  return <div className="text-[13px] leading-6 text-slate-700">
    {blocks.map((block, index) => {
      switch (block.kind) {
        case "heading":
          if (block.level === 1) return null;
          return block.level === 2
            ? <h2 key={index} id={block.id} className="mt-8 mb-2 scroll-mt-20 border-b border-slate-100 pb-1 text-base font-semibold tracking-tight text-slate-950 first:mt-0"><Inline text={block.text} links={links}/></h2>
            : <h3 key={index} id={block.id} className="mt-5 mb-1.5 scroll-mt-20 text-[13px] font-semibold text-slate-900"><Inline text={block.text} links={links}/></h3>;
        case "paragraph": return <p key={index} className="my-2.5"><Inline text={block.text} links={links}/></p>;
        case "list": {
          const items = block.items.map((item, position) => <li key={position} className="pl-1"><Inline text={item} links={links}/></li>);
          return block.ordered ? <ol key={index} className="my-2.5 list-decimal space-y-1 pl-5 marker:text-slate-400">{items}</ol> : <ul key={index} className="my-2.5 list-disc space-y-1 pl-5 marker:text-slate-300">{items}</ul>;
        }
        case "code": return <pre key={index} className="theme-fixed my-3 overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-[11.5px] leading-5 text-slate-200" data-lang={block.lang || undefined}><code>{block.text}</code></pre>;
        case "table": return <div key={index} className="my-3 overflow-x-auto">
          <Table.Root size="1" variant="surface" className="text-left text-[12px] leading-5">
            <Table.Header className="text-[11px] uppercase tracking-wide text-slate-500"><Table.Row>{block.head.map((cell, position) => <Table.ColumnHeaderCell key={position} className="font-semibold"><Inline text={cell} links={links}/></Table.ColumnHeaderCell>)}</Table.Row></Table.Header>
            <Table.Body>{block.rows.map((row, position) => <Table.Row key={position} align="start">{row.map((cell, column) => <Table.Cell key={column}><Inline text={cell} links={links}/></Table.Cell>)}</Table.Row>)}</Table.Body>
          </Table.Root>
        </div>;
        case "quote": return <Callout.Root key={index} size="1" variant="surface" className="my-3"><Callout.Text className="text-[12.5px]"><Inline text={block.text} links={links}/></Callout.Text></Callout.Root>;
        case "rule": return <hr key={index} className="my-6 border-slate-200"/>;
      }
    })}
  </div>;
}
