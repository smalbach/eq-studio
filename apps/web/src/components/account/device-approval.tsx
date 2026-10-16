import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Callout, Select, Spinner } from "@radix-ui/themes";
import { ArrowRight, CircleAlert, CircleCheck, MonitorSmartphone } from "lucide-react";
import { Shell } from "@/components/account/shell";
import { API, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Enlazar un equipo", loading: "Buscando el código…", device: "Equipo", code: "Código",
    check: "Comprueba que este código coincide con el que muestra el equipo. Si no lo pediste tú, recházalo.",
    workspace: "Workspace", approve: "Aprobar", deny: "Rechazar",
    approved: "Aprobado: el equipo termina de enlazarse solo en unos segundos.", denied: "Rechazado: el equipo no quedó enlazado.",
    gone: "Este código caducó o ya se usó. Vuelve a enlazar desde el equipo para obtener uno nuevo.",
    continue: "Continuar a la app", role: { viewer: "lector", editor: "editor", admin: "administrador", owner: "propietario" } as Record<string, string>,
  },
  en: {
    title: "Link a device", loading: "Looking the code up…", device: "Device", code: "Code",
    check: "Check that this code matches the one on the device. If you did not ask for it, deny it.",
    workspace: "Workspace", approve: "Approve", deny: "Deny",
    approved: "Approved: the device finishes linking by itself in a few seconds.", denied: "Denied: the device was not linked.",
    gone: "This code expired or was already used. Link again from the device to get a new one.",
    continue: "Continue to the app", role: { viewer: "viewer", editor: "editor", admin: "admin", owner: "owner" } as Record<string, string>,
  },
});

/**
 * Where a local installation's browser sign-in lands (`?device=<code>`). Shown instead of the
 * dashboard: approving hands that device a token for the chosen workspace, so the person sees
 * the device's name and the code to compare before anything happens.
 */
export function DeviceApproval({ code, onContinue }: { code: string; onContinue: () => void }) {
  const t = useMessages(MESSAGES);
  const session = useSession();
  const workspaces = session.session?.workspaces ?? [];
  const [workspaceId, setWorkspaceId] = useState(session.workspaceId ?? workspaces[0]?.id ?? "");
  const [busy, setBusy] = useState<"" | "approve" | "deny">("");
  const [outcome, setOutcome] = useState<"" | "approved" | "denied">("");
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const device = useQuery({ queryKey: ["device", code], queryFn: () => API.describeDevice(code), retry: false });
  const gone = (device.error instanceof ApiError && device.error.status === 404) || error?.status === 404;

  async function decide(choice: "approve" | "deny") {
    setBusy(choice); setError(null);
    try {
      if (choice === "approve") await API.approveDevice(code, workspaceId);
      else await API.denyDevice(code);
      setOutcome(choice === "approve" ? "approved" : "denied");
    } catch (failure) {
      setError(failure instanceof ApiError ? { status: failure.status, text: failure.full } : { status: 0, text: String(failure) });
    } finally { setBusy(""); }
  }

  const proceed = <Button type="button" size="3" onClick={onContinue} className="mt-1 w-full">{t.continue}<ArrowRight className="size-4"/></Button>;
  const alert = (text: string) => <Callout.Root size="1" color="red" role="alert"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{text}</Callout.Text></Callout.Root>;

  let body: React.ReactNode;
  if (outcome) body = <>
    <Callout.Root size="1" color={outcome === "approved" ? "green" : "gray"} role="status"><Callout.Icon><CircleCheck className="size-4"/></Callout.Icon><Callout.Text>{outcome === "approved" ? t.approved : t.denied}</Callout.Text></Callout.Root>
    {proceed}
  </>;
  else if (gone) body = <>{alert(t.gone)}{proceed}</>;
  else if (device.error) body = <>{alert(device.error instanceof ApiError ? device.error.full : String(device.error))}{proceed}</>;
  else if (!device.data) body = <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner size="2"/>{t.loading}</p>;
  else body = <>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.device}</p>
      <p className="text-sm font-semibold text-slate-900">{device.data.name}</p>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.code}</p>
      <p className="font-mono text-2xl font-bold tracking-[0.2em] text-slate-950">{device.data.userCode}</p>
    </div>
    <p className="text-[11px] leading-5 text-slate-500">{t.check}</p>
    <label className="grid gap-1 text-[11px] text-slate-500">{t.workspace}<Select.Root size="3" value={workspaceId} onValueChange={setWorkspaceId}><Select.Trigger aria-label={t.workspace}/><Select.Content>{workspaces.map((item) => <Select.Item key={item.id} value={item.id}>{item.name} · {t.role[item.role]}</Select.Item>)}</Select.Content></Select.Root></label>
    {error && alert(error.text)}
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" size="3" variant="surface" color="gray" loading={busy === "deny"} disabled={Boolean(busy)} onClick={() => { void decide("deny"); }}>{t.deny}</Button>
      <Button type="button" size="3" loading={busy === "approve"} disabled={Boolean(busy) || !workspaceId} onClick={() => { void decide("approve"); }}>{t.approve}</Button>
    </div>
  </>;

  return <Shell><div className="grid gap-3">
    <p className="flex items-center gap-2 text-base font-semibold"><MonitorSmartphone className="size-4 text-slate-400"/>{t.title}</p>
    {body}
  </div></Shell>;
}
