import { useState } from "react";
import { Button, Select } from "@radix-ui/themes";
import { KeyRound, Trash2 } from "lucide-react";
import type { Environment } from "@/components/environment/use-environment";
import { CREDENTIAL_KINDS, ValueFields } from "@/components/guide/credential-fields";
import type { CredentialKind, CredentialRole, CredentialView } from "@/lib/api";
import { credentialPayload, formOf, type CredentialForm } from "@/lib/credentials.mjs";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Credenciales", stored: "Se guardan cifradas en el API; nunca vuelven al navegador.",
    roles: { primary: "Principal", insufficient: "Permisos insuficientes (403)", alternate: "Alternativa (401 donde no se acepta)" } as Record<CredentialRole, string>,
    roleHints: { primary: "La que presentan los casos normales.", insufficient: "Autentica, pero no alcanza para escribir: provoca los 403.", alternate: "Una credencial que algunas operaciones no aceptan (una API key en un DELETE): provoca los 401." } as Record<CredentialRole, string>,
    kinds: { bearer: "Bearer token", api_key: "API key", basic: "Basic", oauth2_client_credentials: "OAuth2 client credentials", oauth2_authorization_code: "OAuth2 authorization code", cookie: "Cookie de sesión", hmac: "Firma HMAC", mtls: "Certificado de cliente (mTLS)" } as Record<CredentialKind, string>,
    withCert: "+ mTLS", incomplete: "Faltan campos obligatorios para este tipo.",
    save: "Guardar", saved: (last: string | null) => `guardada${last ? ` · …${last}` : ""}`, none: "sin configurar", remove: "Eliminar",
    authOn: "Los casos 401 y 403 están activos.", authOff: "La API de este entorno no exige autenticación: los casos 401 y 403 quedan ocultos.",
    expires: (minutes: number) => `El token expira en ${minutes} min.`, expired: "El token expiró: los casos fallarán con 401.",
  },
  en: {
    title: "Credentials", stored: "Stored encrypted by the API; they never come back to the browser.",
    roles: { primary: "Primary", insufficient: "Insufficient permissions (403)", alternate: "Alternate (401 where not accepted)" } as Record<CredentialRole, string>,
    roleHints: { primary: "What normal cases present.", insufficient: "Authenticates, but cannot write: triggers the 403s.", alternate: "A credential some operations do not accept (an API key on a DELETE): triggers the 401s." } as Record<CredentialRole, string>,
    kinds: { bearer: "Bearer token", api_key: "API key", basic: "Basic", oauth2_client_credentials: "OAuth2 client credentials", oauth2_authorization_code: "OAuth2 authorization code", cookie: "Session cookie", hmac: "HMAC signature", mtls: "Client certificate (mTLS)" } as Record<CredentialKind, string>,
    withCert: "+ mTLS", incomplete: "Required fields are missing for this kind.",
    save: "Save", saved: (last: string | null) => `saved${last ? ` · …${last}` : ""}`, none: "not set", remove: "Delete",
    authOn: "The 401 and 403 cases are active.", authOff: "This environment's API does not enforce authentication: the 401 and 403 cases are hidden.",
    expires: (minutes: number) => `The token expires in ${minutes} min.`, expired: "The token expired: cases will fail with 401.",
  },
});

const DEFAULT_KIND: Record<CredentialRole, CredentialKind> = { primary: "bearer", insufficient: "bearer", alternate: "api_key" };

/** One role's credential: its kind, its fields, and secrets that are written, never read. */
function CredentialRow({ env, role, current }: { env: Environment; role: CredentialRole; current?: CredentialView }) {
  const t = useMessages(MESSAGES);
  // Every field of the saved credential but its secrets: those stay empty and, left empty, keep the stored ones.
  const [form, setForm] = useState<CredentialForm>(() => formOf(current, DEFAULT_KIND[role]));
  const payload = credentialPayload(form, current);
  const blank = (value: CredentialForm) => ({ ...value, secret: "", refreshToken: "", tlsKey: "", tlsPassphrase: "" });
  return <form className="rounded-lg border border-slate-200 bg-panel p-2.5" onSubmit={async (event) => { event.preventDefault(); if (payload && await env.saveCredential(role, payload)) setForm(blank); }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold text-slate-700">{t.roles[role]} <span className="font-normal text-slate-400">· {current ? t.saved(current.lastFour) : t.none}{current?.options?.tls && current.kind !== "mtls" ? ` ${t.withCert}` : ""}</span></p>
      <Select.Root size="1" value={form.kind} onValueChange={(value) => setForm((item) => ({ ...item, kind: value as CredentialKind }))}><Select.Trigger aria-label={`${t.roles[role]} · kind`}/><Select.Content>{CREDENTIAL_KINDS.map((kind) => <Select.Item key={kind} value={kind}>{t.kinds[kind]}</Select.Item>)}</Select.Content></Select.Root>
    </div>
    <p className="text-[10px] text-slate-400">{t.roleHints[role]}</p>
    <div className="mt-1.5"><ValueFields value={form} onChange={setForm} stored={current} credentialRole={role} size="1" apiKeyHeader={env.apiKeyHeader}/></div>
    <div className="mt-2 flex items-center gap-3"><Button type="submit" size="1" disabled={!payload}>{t.save}</Button>{!payload && <span className="text-[10px] text-slate-400">{t.incomplete}</span>}{current && <Button type="button" size="1" variant="ghost" color="red" onClick={() => { void env.deleteCredential(role); }}><Trash2 className="size-3"/>{t.remove}</Button>}</div>
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
