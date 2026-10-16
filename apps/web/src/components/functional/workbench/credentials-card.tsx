import { useState } from "react";
import { Button, Select, TextField } from "@radix-ui/themes";
import { KeyRound, Trash2 } from "lucide-react";
import type { CredentialDraft, Environment } from "@/components/environment/use-environment";
import type { CredentialKind, CredentialRole, CredentialView } from "@/lib/api";
import { cleanToken } from "@/lib/environments.mjs";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Credenciales", stored: "Se guardan cifradas en el API; nunca vuelven al navegador.",
    roles: { primary: "Principal", insufficient: "Permisos insuficientes (403)", alternate: "Alternativa (401 donde no se acepta)" } as Record<CredentialRole, string>,
    roleHints: { primary: "La que presentan los casos normales.", insufficient: "Autentica, pero no alcanza para escribir: provoca los 403.", alternate: "Una credencial que algunas operaciones no aceptan (una API key en un DELETE): provoca los 401." } as Record<CredentialRole, string>,
    kinds: { bearer: "Bearer token", api_key: "API key", basic: "Basic", oauth2_client_credentials: "OAuth2 client credentials" } as Record<CredentialKind, string>,
    secret: "Secreto", keep: "(vacío = conservar el actual)", header: "Cabecera", username: "Usuario", tokenUrl: "URL del token", clientId: "client_id", scope: "scope",
    save: "Guardar", saved: (last: string | null) => `guardada${last ? ` · …${last}` : ""}`, none: "sin configurar", remove: "Eliminar",
    authOn: "Los casos 401 y 403 están activos.", authOff: "La API de este entorno no exige autenticación: los casos 401 y 403 quedan ocultos.",
    expires: (minutes: number) => `El token expira en ${minutes} min.`, expired: "El token expiró: los casos fallarán con 401.",
  },
  en: {
    title: "Credentials", stored: "Stored encrypted by the API; they never come back to the browser.",
    roles: { primary: "Primary", insufficient: "Insufficient permissions (403)", alternate: "Alternate (401 where not accepted)" } as Record<CredentialRole, string>,
    roleHints: { primary: "What normal cases present.", insufficient: "Authenticates, but cannot write: triggers the 403s.", alternate: "A credential some operations do not accept (an API key on a DELETE): triggers the 401s." } as Record<CredentialRole, string>,
    kinds: { bearer: "Bearer token", api_key: "API key", basic: "Basic", oauth2_client_credentials: "OAuth2 client credentials" } as Record<CredentialKind, string>,
    secret: "Secret", keep: "(empty = keep the current one)", header: "Header", username: "User", tokenUrl: "Token URL", clientId: "client_id", scope: "scope",
    save: "Save", saved: (last: string | null) => `saved${last ? ` · …${last}` : ""}`, none: "not set", remove: "Delete",
    authOn: "The 401 and 403 cases are active.", authOff: "This environment's API does not enforce authentication: the 401 and 403 cases are hidden.",
    expires: (minutes: number) => `The token expires in ${minutes} min.`, expired: "The token expired: cases will fail with 401.",
  },
});

const input = "mt-1 w-full font-mono";
const DEFAULT_KIND: Record<CredentialRole, CredentialKind> = { primary: "bearer", insufficient: "bearer", alternate: "api_key" };

/** One role's credential: its kind, its fields, and a secret that is written, never read. */
function CredentialRow({ env, role, current }: { env: Environment; role: CredentialRole; current?: CredentialView }) {
  const t = useMessages(MESSAGES);
  const [draft, setDraft] = useState<CredentialDraft>(() => ({ kind: current?.kind ?? DEFAULT_KIND[role], headerName: current?.headerName ?? null, username: current?.username ?? null, tokenUrl: current?.tokenUrl ?? null, clientId: current?.clientId ?? null, scope: current?.scope ?? null }));
  const [secret, setSecret] = useState("");
  const set = (patch: Partial<CredentialDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const id = `credential-${role}`;
  return <form className="rounded-lg border border-slate-200 bg-panel p-2.5" onSubmit={async (event) => { event.preventDefault(); if (await env.saveCredential(role, { ...draft, ...(secret ? { secret } : {}) })) setSecret(""); }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold text-slate-700">{t.roles[role]} <span className="font-normal text-slate-400">· {current ? t.saved(current.lastFour) : t.none}</span></p>
      <Select.Root size="1" value={draft.kind} onValueChange={(value) => set({ kind: value as CredentialKind })}><Select.Trigger aria-label={`${t.roles[role]} · kind`}/><Select.Content>{(Object.keys(t.kinds) as CredentialKind[]).map((kind) => <Select.Item key={kind} value={kind}>{t.kinds[kind]}</Select.Item>)}</Select.Content></Select.Root>
    </div>
    <p className="text-[10px] text-slate-400">{t.roleHints[role]}</p>
    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
      {draft.kind === "api_key" && <label htmlFor={`${id}-header`} className="text-[10px] text-slate-500">{t.header}<TextField.Root size="1" id={`${id}-header`} value={draft.headerName ?? ""} placeholder={env.apiKeyHeader} onChange={(event) => set({ headerName: event.target.value || null })} className={input}/></label>}
      {draft.kind === "basic" && <label htmlFor={`${id}-user`} className="text-[10px] text-slate-500">{t.username}<TextField.Root size="1" id={`${id}-user`} autoComplete="off" value={draft.username ?? ""} onChange={(event) => set({ username: event.target.value || null })} className={input}/></label>}
      {draft.kind === "oauth2_client_credentials" && <>
        <label htmlFor={`${id}-token-url`} className="text-[10px] text-slate-500 sm:col-span-2">{t.tokenUrl}<TextField.Root size="1" id={`${id}-token-url`} type="url" value={draft.tokenUrl ?? ""} onChange={(event) => set({ tokenUrl: event.target.value || null })} className={input}/></label>
        <label htmlFor={`${id}-client`} className="text-[10px] text-slate-500">{t.clientId}<TextField.Root size="1" id={`${id}-client`} value={draft.clientId ?? ""} onChange={(event) => set({ clientId: event.target.value || null })} className={input}/></label>
        <label htmlFor={`${id}-scope`} className="text-[10px] text-slate-500">{t.scope}<TextField.Root size="1" id={`${id}-scope`} value={draft.scope ?? ""} onChange={(event) => set({ scope: event.target.value || null })} className={input}/></label>
      </>}
      <label htmlFor={`${id}-secret`} className="text-[10px] text-slate-500 sm:col-span-2">{t.secret} {current?.hasSecret && <span className="text-slate-400">{t.keep}</span>}<TextField.Root size="1" id={`${id}-secret`} type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(draft.kind === "bearer" ? cleanToken(event.target.value) : event.target.value)} className={input}/></label>
    </div>
    <div className="mt-2 flex items-center gap-3"><Button type="submit" size="1">{t.save}</Button>{current && <Button type="button" size="1" variant="ghost" color="red" onClick={() => { void env.deleteCredential(role); }}><Trash2 className="size-3"/>{t.remove}</Button>}</div>
  </form>;
}

/** The credentials each kind of case presents in the active environment. */
export function CredentialsCard({ env }: { env: Environment }) {
  const t = useMessages(MESSAGES);
  const roles: CredentialRole[] = env.authEnabled ? ["primary", "insufficient", "alternate"] : ["primary"];
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="flex items-center gap-2 text-xs font-semibold text-slate-700"><KeyRound className="size-3.5 text-slate-400"/>{t.title}</p>
    <p className="mb-2 text-[10px] text-slate-400">{t.stored}</p>
    <div className="grid gap-2">{roles.map((role) => { const current = env.credentials.find((item) => item.role === role); return <CredentialRow key={`${env.environmentId}:${role}:${current?.rev ?? 0}`} env={env} role={role} current={current}/>; })}</div>
    {env.tokenInfo.state === "expired" && <p className="mt-2 text-[11px] leading-5 text-rose-600">{t.expired}</p>}
    {env.tokenInfo.state === "valid" && env.tokenInfo.minutesLeft != null && <p className="mt-2 text-[11px] leading-5 text-slate-500">{t.expires(env.tokenInfo.minutesLeft)}</p>}
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{env.authEnabled ? t.authOn : t.authOff}</p>
  </div>;
}
