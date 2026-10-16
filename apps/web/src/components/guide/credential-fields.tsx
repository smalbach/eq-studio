import { RadioCards, TextField } from "@radix-ui/themes";
import { Field } from "@/components/guide/guide-kit";
import type { CredentialKind } from "@/lib/api";
import { defineMessages, useMessages } from "@/lib/i18n";

/**
 * The form of one credential, shared by the first-project and credentials guides. Its values
 * stay in component state only: a guide's draft is kept in the browser to be resumed, and a
 * secret must never be part of it. Once saved, the API encrypts the secret and never returns it.
 */

export type CredentialForm = { kind: CredentialKind; secret: string; headerName: string; username: string; tokenUrl: string; clientId: string; scope: string };
export const EMPTY_CREDENTIAL: CredentialForm = { kind: "bearer", secret: "", headerName: "", username: "", tokenUrl: "", clientId: "", scope: "" };

const MESSAGES = defineMessages({
  es: {
    kinds: {
      bearer: ["Token bearer", "Authorization: Bearer <token>. Un JWT o un token opaco."],
      api_key: ["API key", "Una clave en una cabecera propia (X-API-Key por defecto)."],
      basic: ["Basic", "Usuario y contraseña en Authorization: Basic."],
      oauth2_client_credentials: ["OAuth2 client credentials", "El API pide el token al servidor de autorización una vez por corrida y lo renueva solo."],
    } as Record<CredentialKind, [string, string]>,
    token: "Token", key: "Clave", password: "Contraseña", clientSecret: "Client secret", header: "Cabecera", headerHint: "Vacío = la del proyecto (auth.apiKeyHeader).", username: "Usuario",
    tokenUrl: "URL del token", clientId: "Client id", scope: "Scope (opcional)", secretHint: "Se cifra al guardarse y nunca vuelve al navegador.",
  },
  en: {
    kinds: {
      bearer: ["Bearer token", "Authorization: Bearer <token>. A JWT or an opaque token."],
      api_key: ["API key", "A key in a header of its own (X-API-Key by default)."],
      basic: ["Basic", "Username and password in Authorization: Basic."],
      oauth2_client_credentials: ["OAuth2 client credentials", "The API asks the authorization server for a token once per run and renews it by itself."],
    } as Record<CredentialKind, [string, string]>,
    token: "Token", key: "Key", password: "Password", clientSecret: "Client secret", header: "Header", headerHint: "Empty = the project's (auth.apiKeyHeader).", username: "Username",
    tokenUrl: "Token URL", clientId: "Client id", scope: "Scope (optional)", secretHint: "Encrypted when saved, and never comes back to the browser.",
  },
});

export const CREDENTIAL_KINDS: CredentialKind[] = ["bearer", "api_key", "basic", "oauth2_client_credentials"];

/** Whether nothing was typed, something was but not enough, or the credential can be saved. */
export function credentialState(form: CredentialForm): "empty" | "incomplete" | "complete" {
  const typed = [form.secret, form.username, form.tokenUrl, form.clientId, form.scope, form.headerName].some((value) => value.trim());
  if (!typed) return "empty";
  return credentialDraftOf(form) ? "complete" : "incomplete";
}

/** The credential as the API takes it, or `null` while a required field is missing. */
export function credentialDraftOf(form: CredentialForm) {
  const secret = form.secret.trim();
  if (!secret) return null;
  if (form.kind === "bearer") return { kind: form.kind, secret };
  if (form.kind === "api_key") return { kind: form.kind, secret, headerName: form.headerName.trim() || null };
  if (form.kind === "basic") return form.username.trim() ? { kind: form.kind, secret, username: form.username.trim() } : null;
  if (!/^https?:\/\/\S+$/.test(form.tokenUrl.trim()) || !form.clientId.trim()) return null;
  return { kind: form.kind, secret, tokenUrl: form.tokenUrl.trim(), clientId: form.clientId.trim(), scope: form.scope.trim() || null };
}

export function KindPicker({ value, onChange }: { value: CredentialKind; onChange: (kind: CredentialKind) => void }) {
  const t = useMessages(MESSAGES);
  return <RadioCards.Root size="1" value={value} onValueChange={(kind) => onChange(kind as CredentialKind)} columns={{ initial: "1", sm: "2" }} gap="2">{CREDENTIAL_KINDS.map((kind) => <RadioCards.Item key={kind} value={kind} className="justify-start text-left text-[11px]">
    <span><span className="block text-xs font-semibold text-slate-900">{t.kinds[kind][0]}</span><span className="mt-0.5 block text-slate-500">{t.kinds[kind][1]}</span></span>
  </RadioCards.Item>)}</RadioCards.Root>;
}

export function ValueFields({ value, onChange }: { value: CredentialForm; onChange: (value: CredentialForm) => void }) {
  const t = useMessages(MESSAGES);
  const set = (patch: Partial<CredentialForm>) => onChange({ ...value, ...patch });
  // `new-password` keeps the browser from offering a saved password for this field.
  const secret = (label: string) => <Field label={label} hint={t.secretHint}><TextField.Root size="2" type="password" autoComplete="new-password" value={value.secret} onChange={(event) => set({ secret: event.target.value })} className="mt-1 font-mono"/></Field>;
  return <div className="grid gap-3 sm:grid-cols-2">
    {value.kind === "bearer" && <div className="sm:col-span-2">{secret(t.token)}</div>}
    {value.kind === "api_key" && <><Field label={t.header} hint={t.headerHint}><TextField.Root size="2" value={value.headerName} onChange={(event) => set({ headerName: event.target.value })} placeholder="X-API-Key" className="mt-1 font-mono"/></Field>{secret(t.key)}</>}
    {value.kind === "basic" && <><Field label={t.username}><TextField.Root size="2" autoComplete="off" value={value.username} onChange={(event) => set({ username: event.target.value })} className="mt-1 font-mono"/></Field>{secret(t.password)}</>}
    {value.kind === "oauth2_client_credentials" && <>
      <Field label={t.tokenUrl} className="sm:col-span-2"><TextField.Root size="2" type="url" value={value.tokenUrl} onChange={(event) => set({ tokenUrl: event.target.value })} placeholder="https://auth.example.com/oauth/token" className="mt-1 font-mono"/></Field>
      <Field label={t.clientId}><TextField.Root size="2" autoComplete="off" value={value.clientId} onChange={(event) => set({ clientId: event.target.value })} className="mt-1 font-mono"/></Field>
      <Field label={t.scope}><TextField.Root size="2" value={value.scope} onChange={(event) => set({ scope: event.target.value })} placeholder="orders:read orders:write" className="mt-1 font-mono"/></Field>
      <div className="sm:col-span-2">{secret(t.clientSecret)}</div>
    </>}
  </div>;
}

/** Kind and value together, for the guide that asks for both on one step. */
export function CredentialFields({ value, onChange }: { value: CredentialForm; onChange: (value: CredentialForm) => void }) {
  return <div className="space-y-4">
    <KindPicker value={value.kind} onChange={(kind) => onChange({ ...value, kind })}/>
    <ValueFields value={value} onChange={onChange}/>
  </div>;
}
