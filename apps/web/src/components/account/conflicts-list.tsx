import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout } from "@radix-ui/themes";
import { CircleAlert, GitMerge } from "lucide-react";
import { API, ApiError, type SyncConflict } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { conflictValue } from "@/lib/sync.mjs";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    thisDevice: "Este equipo", cloud: "Nube", keepMine: "Quedarme con el de este equipo", keepTheirs: "Quedarme con el de la nube", useDevice: "Usar el del dispositivo",
    none: "No hay conflictos.", noRole: "Tu rol no alcanza para resolver este conflicto.",
    type: { spec: "contrato", project: "proyecto", environment: "entorno", credential: "credencial", run: "corrida" } as Record<string, string>,
  },
  en: {
    thisDevice: "This device", cloud: "Cloud", keepMine: "Keep this device's", keepTheirs: "Keep the cloud's", useDevice: "Use the device's",
    none: "No conflicts.", noRole: "Your role is not enough to resolve this conflict.",
    type: { spec: "contract", project: "project", environment: "environment", credential: "credential", run: "run" } as Record<string, string>,
  },
});

/** The open conflicts, shared by the local Settings and the cloud's: one cache entry for both. */
export const useConflicts = (enabled = true) => useQuery({ queryKey: ["sync", "conflicts"], queryFn: API.syncConflicts, enabled });

function Value({ label, value }: { label: string; value: unknown }) {
  return <div className="min-w-0">
    <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[10.5px] leading-4 text-slate-800">{conflictValue(value)}</pre>
  </div>;
}

/**
 * Conflicts are kept until a person chooses: two devices changed the same field differently and
 * neither value is thrown away silently. Locally "mine" is this installation; in the cloud it is
 * the device that pushed the change, so the labels say whose value each side is.
 */
export function ConflictsList({ conflicts, mode, canResolve = () => true, showEmpty }: { conflicts: SyncConflict[]; mode: "local" | "cloud"; canResolve?: (conflict: SyncConflict) => boolean; showEmpty?: boolean }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const client = useQueryClient();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  async function resolve(conflict: SyncConflict, choice: "mine" | "theirs") {
    setBusy(`${conflict.id}:${choice}`); setError(null);
    try {
      await API.resolveConflict(conflict.id, choice);
      await client.invalidateQueries();
    } catch (failure) {
      setError({ id: conflict.id, text: failure instanceof ApiError ? failure.full : String(failure) });
    } finally { setBusy(""); }
  }

  if (!conflicts.length) return showEmpty ? <p className="text-[11px] text-slate-500">{t.none}</p> : null;
  return <ul className="grid gap-3">{conflicts.map((conflict) => {
    const allowed = canResolve(conflict);
    return <li key={conflict.id} className="rounded-[var(--radius-4)] border border-amber-200 bg-amber-50/40 p-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <GitMerge className="size-3.5 text-amber-600"/>
        <span className="font-semibold text-slate-900">{conflict.label}</span>
        <span className="font-mono text-[11px] text-slate-500">· {conflict.field}</span>
        <Badge size="1" variant="surface" color="gray">{t.type[conflict.type] ?? conflict.type}</Badge>
        <span className="ml-auto text-[10px] text-slate-400">{formatDate(Date.parse(conflict.createdAt), locale)}</span>
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Value label={mode === "local" ? t.thisDevice : conflict.device} value={conflict.mine}/>
        <Value label={t.cloud} value={conflict.theirs}/>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="1" variant="surface" color="gray" loading={busy === `${conflict.id}:mine`} disabled={!allowed || Boolean(busy)} onClick={() => { void resolve(conflict, "mine"); }}>{mode === "local" ? t.keepMine : t.useDevice}</Button>
        <Button type="button" size="1" variant="surface" color="gray" loading={busy === `${conflict.id}:theirs`} disabled={!allowed || Boolean(busy)} onClick={() => { void resolve(conflict, "theirs"); }}>{t.keepTheirs}</Button>
        {!allowed && <span className="text-[11px] text-slate-500">{t.noRole}</span>}
      </div>
      {error?.id === conflict.id && <Callout.Root size="1" color="red" role="alert" className="mt-2"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error.text}</Callout.Text></Callout.Root>}
    </li>;
  })}</ul>;
}
