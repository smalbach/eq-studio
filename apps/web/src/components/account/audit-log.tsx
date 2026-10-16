import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Badge, Button, Callout, Select, Table, TextField } from "@radix-ui/themes";
import { CircleAlert, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { API, ApiError } from "@/lib/api";
import { AUDIT_GROUPS, auditDetail, auditQuery } from "@/lib/audit.mjs";
import { formatDate } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const MESSAGES = defineMessages({
  es: {
    title: "Registro de auditoría", hint: "Inicios de sesión, contraseñas, miembros, tokens, credenciales, proyectos borrados y dispositivos de este workspace. Nunca guarda contraseñas, tokens ni el valor de una credencial, y no se puede editar ni borrar.",
    all: "Todo", from: "Desde", to: "Hasta", more: "Cargar más", empty: "No hay eventos con estos filtros.", when: "Cuándo", event: "Evento", who: "Quién", target: "Sobre", details: "Detalle", system: "—",
    group: { "auth.": "Sesiones y contraseñas", "member.": "Miembros", "api_token.": "Tokens de API", "credential.": "Credenciales", "project.": "Proyectos", "device.": "Dispositivos" } as Record<string, string>,
    type: {
      "auth.sign_in.succeeded": "Inicio de sesión", "auth.sign_in.failed": "Inicio de sesión fallido", "auth.password.changed": "Contraseña cambiada", "auth.password.reset": "Contraseña restablecida", "auth.password.reset_link_created": "Enlace de restablecimiento creado",
      "member.invited": "Invitación creada", "member.joined": "Miembro se unió", "member.removed": "Miembro quitado", "member.role_changed": "Rol cambiado",
      "api_token.created": "Token creado", "api_token.revoked": "Token revocado", "credential.created": "Credencial creada", "credential.updated": "Credencial cambiada", "credential.deleted": "Credencial borrada",
      "project.deleted": "Proyecto borrado", "device.linked": "Dispositivo enlazado", "device.unlinked": "Dispositivo desenlazado",
    } as Record<string, string>,
  },
  en: {
    title: "Audit log", hint: "Sign-ins, passwords, members, tokens, credentials, deleted projects and devices of this workspace. It never keeps passwords, tokens or a credential's value, and it cannot be edited or deleted.",
    all: "Everything", from: "From", to: "To", more: "Load more", empty: "No events with these filters.", when: "When", event: "Event", who: "Who", target: "On", details: "Details", system: "—",
    group: { "auth.": "Sessions and passwords", "member.": "Members", "api_token.": "API tokens", "credential.": "Credentials", "project.": "Projects", "device.": "Devices" } as Record<string, string>,
    type: {
      "auth.sign_in.succeeded": "Signed in", "auth.sign_in.failed": "Failed sign-in", "auth.password.changed": "Password changed", "auth.password.reset": "Password reset", "auth.password.reset_link_created": "Reset link created",
      "member.invited": "Invitation created", "member.joined": "Member joined", "member.removed": "Member removed", "member.role_changed": "Role changed",
      "api_token.created": "Token created", "api_token.revoked": "Token revoked", "credential.created": "Credential created", "credential.updated": "Credential changed", "credential.deleted": "Credential deleted",
      "project.deleted": "Project deleted", "device.linked": "Device linked", "device.unlinked": "Device unlinked",
    } as Record<string, string>,
  },
});

const ALERTS = new Set(["auth.sign_in.failed", "member.removed", "api_token.revoked", "credential.deleted", "project.deleted", "auth.password.reset_link_created"]);

/** The workspace's audit log, newest first, for admins and owners (the API checks the same). */
export function AuditLogCard({ className }: { className?: string }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const session = useSession();
  const [filter, setFilter] = useState({ type: "", from: "", to: "" });
  const log = useInfiniteQuery({
    queryKey: ["audit", session.workspaceId, filter],
    queryFn: ({ pageParam }) => API.audit(auditQuery({ ...filter, cursor: pageParam, limit: 50 })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const events = log.data?.pages.flatMap((page) => page.items) ?? [];
  return <Card className={className ? `p-5 ${className}` : "p-5"}>
    <p className="flex items-center gap-2 text-sm font-semibold"><ScrollText className="size-4 text-slate-400"/>{t.title}</p>
    <p className="mt-1 text-[11px] leading-5 text-slate-500">{t.hint}</p>
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <Select.Root size="2" value={filter.type || "all"} onValueChange={(value) => setFilter({ ...filter, type: value === "all" ? "" : value })}>
        <Select.Trigger aria-label={t.event}/>
        <Select.Content><Select.Item value="all">{t.all}</Select.Item>{AUDIT_GROUPS.map((group) => <Select.Item key={group} value={group}>{t.group[group]}</Select.Item>)}</Select.Content>
      </Select.Root>
      <label className="grid gap-0.5 text-[11px] text-slate-500">{t.from}<TextField.Root size="2" type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })}/></label>
      <label className="grid gap-0.5 text-[11px] text-slate-500">{t.to}<TextField.Root size="2" type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })}/></label>
    </div>
    {log.error && <Callout.Root size="1" color="red" role="alert" className="mt-3"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text>{log.error instanceof ApiError ? log.error.full : String(log.error)}</Callout.Text></Callout.Root>}
    <div className="mt-3 overflow-x-auto">
      <Table.Root size="1" variant="ghost" className="text-xs">
        <Table.Header><Table.Row><Table.ColumnHeaderCell>{t.when}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t.event}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t.who}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t.target}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t.details}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>IP</Table.ColumnHeaderCell></Table.Row></Table.Header>
        <Table.Body>{events.map((event) => <Table.Row key={event.id} align="center">
          <Table.Cell className="whitespace-nowrap text-slate-500">{formatDate(Date.parse(event.createdAt), locale)}</Table.Cell>
          <Table.Cell><Badge size="1" variant="soft" color={ALERTS.has(event.type) ? "amber" : "gray"}>{t.type[event.type] ?? event.type}</Badge></Table.Cell>
          <Table.Cell className="font-medium">{event.actorLabel ?? t.system}</Table.Cell>
          <Table.Cell className="text-slate-600">{event.targetLabel ?? t.system}</Table.Cell>
          <Table.Cell className="text-slate-500">{auditDetail(event.detail)}</Table.Cell>
          <Table.Cell className="font-mono text-[11px] text-slate-400">{event.ip ?? ""}</Table.Cell>
        </Table.Row>)}</Table.Body>
      </Table.Root>
    </div>
    {!log.isLoading && !events.length && !log.error && <p className="mt-3 text-xs text-slate-500">{t.empty}</p>}
    {log.hasNextPage && <Button type="button" size="1" variant="soft" color="gray" loading={log.isFetchingNextPage} onClick={() => { void log.fetchNextPage(); }} className="mt-3">{t.more}</Button>}
  </Card>;
}
