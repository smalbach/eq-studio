import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout, Code, IconButton, Link, Select, Table, TextField } from "@radix-ui/themes";
import { Check, CircleAlert, CircleCheck, Copy, GitMerge, KeyRound, LifeBuoy, LogOut, Palette, Trash2, UserPlus, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AppearanceSettings } from "@/components/app/appearance";
import { ConflictsList, useConflicts } from "@/components/account/conflicts-list";
import { SyncCard } from "@/components/account/sync-card";
import { AuditLogCard } from "@/components/account/audit-log";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import { API, ApiError } from "@/lib/api";
import { chooseWorkspace, signedIn, signOut, useSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Ajustes", description: "Tu cuenta, el workspace, quién tiene acceso y los tokens para CI.",
    local: "Modo local: no hay cuentas y todo lo que hay en este equipo es tuyo. Las cuentas, los roles y los tokens existen en un despliegue en la nube (EQ_MODE=cloud); puedes enlazar esta instalación a un workspace de la nube para sincronizarla.",
    account: "Cuenta", signOut: "Cerrar sesión", password: "Cambiar contraseña", current: "Actual", next: "Nueva (10+ caracteres)", change: "Cambiar", changed: "Contraseña cambiada: las otras sesiones se cerraron.",
    workspaces: "Workspaces", switch: "Abrir", newWorkspace: "Nuevo workspace", create: "Crear", role: { viewer: "lector", editor: "editor", admin: "administrador", owner: "propietario" } as Record<string, string>,
    members: "Miembros", remove: "Quitar", invite: "Invitar", email: "Correo", send: "Crear invitación", pending: "Invitaciones pendientes", cancel: "Cancelar",
    inviteLink: "Comparte este enlace con la persona invitada (válido 7 días, se muestra una sola vez):",
    tokens: "Tokens de API", tokensHint: "Para CI y scripts: actúan en este workspace con su rol. El token se muestra una sola vez.", name: "Nombre", issue: "Crear token", revoke: "Revocar", revoked: "revocado", lastUsed: "último uso", never: "nunca",
    tokenOnce: "Cópialo ahora; no se volverá a mostrar:", useIt: "Úsalo así:",
    devicesHint: "Los equipos enlazados con «eq login» o desde Ajustes → Sincronización de una app local aparecen aquí como dispositivos; revocar uno corta su sincronización.", deviceBadge: "dispositivo",
    conflicts: "Conflictos de sincronización", conflictsHint: "Un dispositivo cambió algo que en la nube también cambió. Se aplicó el valor de la nube; elige cuál se queda.",
    appearance: "Apariencia", appearanceHint: "Tema, color de acento, gris, radio y escala. Se guardan en este navegador.", copy: "Copiar",
    resetLink: "Enlace para restablecer la contraseña", resetSent: (email: string) => `Enviamos a ${email} un enlace para elegir una contraseña nueva (vale 30 minutos).`,
    resetShown: "Pasa este enlace a la persona por un canal de confianza (vale 30 minutos, se usa una vez y se muestra una sola vez):",
    roles: "Lector: ve todo. Editor: edita la configuración y lanza corridas de solo lectura. Administrador: entornos, credenciales, corridas con escrituras, carga, miembros y tokens. Propietario: además, los roles.",
  },
  en: {
    title: "Settings", description: "Your account, the workspace, who has access and the tokens for CI.",
    local: "Local mode: there are no accounts and everything on this machine is yours. Accounts, roles and tokens exist in a cloud deployment (EQ_MODE=cloud); you can link this installation to a cloud workspace to sync it.",
    account: "Account", signOut: "Sign out", password: "Change password", current: "Current", next: "New (10+ characters)", change: "Change", changed: "Password changed: the other sessions were closed.",
    workspaces: "Workspaces", switch: "Open", newWorkspace: "New workspace", create: "Create", role: { viewer: "viewer", editor: "editor", admin: "admin", owner: "owner" } as Record<string, string>,
    members: "Members", remove: "Remove", invite: "Invite", email: "Email", send: "Create invitation", pending: "Pending invitations", cancel: "Cancel",
    inviteLink: "Share this link with the person you invited (valid 7 days, shown only once):",
    tokens: "API tokens", tokensHint: "For CI and scripts: they act in this workspace with their role. The token is shown only once.", name: "Name", issue: "Create token", revoke: "Revoke", revoked: "revoked", lastUsed: "last used", never: "never",
    tokenOnce: "Copy it now; it will not be shown again:", useIt: "Use it like this:",
    devicesHint: "Devices linked with \"eq login\" or from a local app's Settings → Sync show up here as devices; revoking one stops its sync.", deviceBadge: "device",
    conflicts: "Sync conflicts", conflictsHint: "A device changed something that also changed in the cloud. The cloud's value was applied; choose which one stays.",
    appearance: "Appearance", appearanceHint: "Theme, accent colour, gray, radius and scaling. Saved in this browser.", copy: "Copy",
    resetLink: "Password reset link", resetSent: (email: string) => `We emailed ${email} a link to choose a new password (valid for 30 minutes).`,
    resetShown: "Pass this link on to the person through a channel you trust (valid for 30 minutes, works once, shown only once):",
    roles: "Viewer: sees everything. Editor: edits configuration and starts read-only runs. Admin: environments, credentials, runs with writes, load tests, members and tokens. Owner: also roles.",
  },
});

const ROLES = ["viewer", "editor", "admin", "owner"];

function Secret({ value }: { value: string }) {
  const t = useMessages(MESSAGES);
  const [copied, setCopied] = useState(false);
  return <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-3)] border border-amber-200 bg-amber-50 p-2"><code className="flex-1 break-all font-mono text-[11px]">{value}</code><IconButton type="button" size="1" variant="surface" color="gray" aria-label={t.copy} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{copied ? <Check className="size-3.5"/> : <Copy className="size-3.5"/>}</IconButton></div>;
}

/** The theme settings, first in both views: they are this browser's, signed in or not. */
function AppearanceCard({ className }: { className?: string }) {
  const t = useMessages(MESSAGES);
  return <Card className={className ? `p-5 ${className}` : "p-5"}>
    <p className="flex items-center gap-2 text-sm font-semibold"><Palette className="size-4 text-slate-400"/>{t.appearance}</p>
    <p className="mt-1 mb-4 text-[11px] text-slate-500">{t.appearanceHint}</p>
    <AppearanceSettings/>
  </Card>;
}

/**
 * The account side of a hosted deployment. Each section shows only to the roles that can use it,
 * and the API checks the same roles again: hiding a button is a courtesy, not the control.
 */
export function SettingsPage({ crumbs }: { crumbs: Crumb[] }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const client = useQueryClient();
  const session = useSession();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [issued, setIssued] = useState("");
  const [form, setForm] = useState({ current: "", next: "", workspace: "", email: "", inviteRole: "editor", tokenName: "", tokenRole: "editor" });
  const set = (patch: Partial<typeof form>) => setForm((value) => ({ ...value, ...patch }));
  const workspace = session.session?.workspaces.find((item) => item.id === session.workspaceId);
  const role = workspace?.role ?? "viewer";
  const isAdmin = role === "admin" || role === "owner";
  const members = useQuery({ queryKey: ["members", session.workspaceId], queryFn: API.members, enabled: session.status === "signed-in" });
  const invitations = useQuery({ queryKey: ["invitations", session.workspaceId], queryFn: API.invitations, enabled: session.status === "signed-in" && isAdmin });
  const tokens = useQuery({ queryKey: ["api-tokens", session.workspaceId], queryFn: API.apiTokens, enabled: session.status === "signed-in" && isAdmin });
  const conflicts = useConflicts(session.status === "signed-in");
  // The API's rule: an editor resolves, an admin when the conflict is about an environment or a credential.
  const canResolve = (type: string) => role !== "viewer" && (isAdmin || (type !== "environment" && type !== "credential"));
  const act = async (work: () => Promise<unknown>, done?: string) => {
    setError(""); setNotice("");
    try { await work(); if (done) setNotice(done); await client.invalidateQueries(); } catch (failure) { setError(failure instanceof ApiError ? failure.full : String(failure)); }
  };
  const reloadSession = async () => { const me = await API.me(); if (session.session) signedIn({ ...session.session, user: { id: me.id, email: me.email, name: me.name }, workspaces: me.workspaces }); };

  if (session.status === "local") return <><PageHeader crumbs={crumbs} title={t.title} description={t.description}/><div className="grid gap-5"><AppearanceCard/><Card className="p-5 text-sm text-slate-600">{t.local}</Card><SyncCard/></div></>;

  return <>
    <PageHeader crumbs={crumbs} title={t.title} description={t.description}/>
    {error && <Callout.Root size="1" color="red" role="alert" className="mb-4"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}
    {notice && <Callout.Root size="1" color="green" role="status" className="mb-4"><Callout.Icon><CircleCheck className="size-4"/></Callout.Icon><Callout.Text>{notice}</Callout.Text></Callout.Root>}
    <div className="grid gap-5 xl:grid-cols-2">
      <AppearanceCard className="xl:col-span-2"/>
      {!!conflicts.data?.length && <Card className="border-amber-200 p-5 xl:col-span-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><GitMerge className="size-4 text-amber-500"/>{t.conflicts} ({conflicts.data.length})</p>
        <p className="mt-1 text-[11px] text-slate-500">{t.conflictsHint}</p>
        <div className="mt-3"><ConflictsList conflicts={conflicts.data} mode="cloud" canResolve={(conflict) => canResolve(conflict.type)}/></div>
      </Card>}
      <Card className="p-5">
        <p className="text-sm font-semibold">{t.account}</p>
        <p className="mt-1 text-xs text-slate-500">{session.session?.user.name} · {session.session?.user.email}</p>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void act(() => API.changePassword(form.current, form.next), t.changed); }}>
          <p className="w-full text-xs font-medium text-slate-600">{t.password}</p>
          <TextField.Root size="2" type="password" aria-label={t.current} placeholder={t.current} autoComplete="current-password" value={form.current} onChange={(event) => set({ current: event.target.value })}/>
          <TextField.Root size="2" type="password" aria-label={t.next} placeholder={t.next} autoComplete="new-password" value={form.next} onChange={(event) => set({ next: event.target.value })}/>
          <Button type="submit" size="2">{t.change}</Button>
        </form>
        <Button type="button" size="1" variant="ghost" color="gray" onClick={() => { void signOut(); }} className="mt-4"><LogOut className="size-3.5"/>{t.signOut}</Button>
      </Card>
      <Card className="p-5">
        <p className="text-sm font-semibold">{t.workspaces}</p>
        <ul className="mt-3 grid gap-1.5">{session.session?.workspaces.map((item) => <li key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs"><span><span className="font-medium">{item.name}</span> <span className="text-slate-400">· {t.role[item.role]}</span></span>{item.id !== session.workspaceId && <Link asChild size="1"><button type="button" onClick={() => chooseWorkspace(item.id)}>{t.switch}</button></Link>}</li>)}</ul>
        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void act(async () => { const created = await API.createWorkspace(form.workspace); await reloadSession(); chooseWorkspace(created.id); set({ workspace: "" }); }); }}>
          <TextField.Root size="2" aria-label={t.newWorkspace} placeholder={t.newWorkspace} required value={form.workspace} onChange={(event) => set({ workspace: event.target.value })} className="flex-1"/>
          <Button type="submit" size="2">{t.create}</Button>
        </form>
      </Card>
      <Card className="p-5 xl:col-span-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-slate-400"/>{t.members}</p>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">{t.roles}</p>
        <Table.Root size="1" variant="ghost" className="mt-3 text-xs"><Table.Body>{(members.data ?? []).map((member) => <Table.Row key={member.userId} align="center">
          <Table.Cell className="font-medium">{member.name}</Table.Cell><Table.Cell className="text-slate-500">{member.email}</Table.Cell>
          <Table.Cell>{role === "owner" ? <Select.Root size="1" value={member.role} onValueChange={(value) => { void act(async () => { await API.changeRole(member.userId, value); await reloadSession(); }); }}><Select.Trigger aria-label={`${member.email} role`}/><Select.Content>{ROLES.map((item) => <Select.Item key={item} value={item}>{t.role[item]}</Select.Item>)}</Select.Content></Select.Root> : t.role[member.role]}</Table.Cell>
          <Table.Cell justify="end">{isAdmin && member.userId !== session.session?.user.id && (role === "owner" || member.role === "viewer" || member.role === "editor") && <IconButton type="button" size="1" variant="ghost" color="gray" className="mr-2" onClick={() => { void act(async () => { setResetLink(""); const link = await API.memberResetLink(member.userId); if (link.token) setResetLink(`${window.location.origin}/?restablecer=${link.token}`); else setNotice(t.resetSent(member.email)); }); }} aria-label={`${t.resetLink} ${member.email}`} title={t.resetLink}><LifeBuoy className="size-3.5"/></IconButton>}
            {isAdmin && member.userId !== session.session?.user.id && <IconButton type="button" size="1" variant="ghost" color="red" onClick={() => { void act(() => API.removeMember(member.userId)); }} aria-label={`${t.remove} ${member.email}`}><Trash2 className="size-3.5"/></IconButton>}</Table.Cell>
        </Table.Row>)}</Table.Body></Table.Root>
        {resetLink && <><p className="mt-3 text-[11px] text-slate-600">{t.resetShown}</p><Secret value={resetLink}/></>}
        {isAdmin && <>
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void act(async () => { const invited = await API.invite(form.email, form.inviteRole); setInviteLink(`${window.location.origin}/?invitacion=${invited.token}`); set({ email: "" }); }); }}>
            <TextField.Root size="2" type="email" required aria-label={t.email} placeholder={t.email} value={form.email} onChange={(event) => set({ email: event.target.value })} className="flex-1"/>
            <Select.Root size="2" value={form.inviteRole} onValueChange={(value) => set({ inviteRole: value })}><Select.Trigger aria-label="role"/><Select.Content>{ROLES.filter((item) => role === "owner" || item !== "owner").map((item) => <Select.Item key={item} value={item}>{t.role[item]}</Select.Item>)}</Select.Content></Select.Root>
            <Button type="submit" size="2"><UserPlus className="size-3.5"/>{t.send}</Button>
          </form>
          {inviteLink && <><p className="mt-3 text-[11px] text-slate-600">{t.inviteLink}</p><Secret value={inviteLink}/></>}
          {!!invitations.data?.length && <><p className="mt-4 text-xs font-medium text-slate-600">{t.pending}</p><ul className="mt-1 grid gap-1">{invitations.data.map((item) => <li key={item.id} className="flex items-center justify-between text-xs text-slate-600"><span>{item.email} · {t.role[item.role]} · {formatDate(Date.parse(item.expiresAt), locale)}</span><Button type="button" size="1" variant="ghost" color="red" onClick={() => { void act(() => API.cancelInvitation(item.id)); }}>{t.cancel}</Button></li>)}</ul></>}
        </>}
      </Card>
      {isAdmin && <Card className="p-5 xl:col-span-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-slate-400"/>{t.tokens}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t.tokensHint}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{t.devicesHint}</p>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void act(async () => { const created = await API.issueApiToken(form.tokenName, form.tokenRole); setIssued(created.token); set({ tokenName: "" }); }); }}>
          <TextField.Root size="2" required aria-label={t.name} placeholder={`${t.name} (CI staging)`} value={form.tokenName} onChange={(event) => set({ tokenName: event.target.value })} className="flex-1"/>
          <Select.Root size="2" value={form.tokenRole} onValueChange={(value) => set({ tokenRole: value })}><Select.Trigger aria-label="token role"/><Select.Content>{["viewer", "editor", "admin"].map((item) => <Select.Item key={item} value={item}>{t.role[item]}</Select.Item>)}</Select.Content></Select.Root>
          <Button type="submit" size="2">{t.issue}</Button>
        </form>
        {issued && <><p className="mt-3 text-[11px] text-slate-600">{t.tokenOnce}</p><Secret value={issued}/><p className="mt-2 text-[11px] text-slate-600">{t.useIt}</p><Secret value={`EQ_API_TOKEN=${issued} npx endpoint-quality run <project> --env <environment> --api ${window.location.origin}`}/></>}
        <Table.Root size="1" variant="ghost" className="mt-4 text-xs"><Table.Body>{(tokens.data ?? []).map((token) => <Table.Row key={token.id} align="center">
          <Table.Cell className="font-medium">{token.name}{token.kind === "device" && <Badge size="1" variant="soft" color="sky" className="ml-2">{t.deviceBadge}</Badge>}</Table.Cell><Table.Cell><Code size="1" variant="ghost" color="gray">{token.prefix}…</Code></Table.Cell><Table.Cell>{t.role[token.role]}</Table.Cell>
          <Table.Cell className="text-slate-500">{t.lastUsed} {token.lastUsedAt ? formatDate(Date.parse(token.lastUsedAt), locale) : t.never}</Table.Cell>
          <Table.Cell justify="end">{token.revokedAt ? <span className="text-slate-400">{t.revoked}</span> : <Button type="button" size="1" variant="ghost" color="red" onClick={() => { void act(() => API.revokeApiToken(token.id)); }}>{t.revoke}</Button>}</Table.Cell>
        </Table.Row>)}</Table.Body></Table.Root>
      </Card>}
      {isAdmin && <AuditLogCard className="xl:col-span-2"/>}
    </div>
  </>;
}
