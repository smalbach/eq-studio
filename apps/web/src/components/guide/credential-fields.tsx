import { useId, type ReactNode } from "react";
import { Button, RadioCards, SegmentedControl, Select, TextArea, TextField } from "@radix-ui/themes";
import { FileUp } from "lucide-react";
import { Field } from "@/components/guide/guide-kit";
import type { CredentialKind, CredentialView } from "@/lib/api";
import { CREDENTIAL_KINDS, credentialPayload, credentialTyped, EMPTY_CREDENTIAL, HMAC_DEFAULT_TEMPLATE, HMAC_PLACEHOLDERS, LOGIN_BODY_TEMPLATE, unknownPlaceholders, type CredentialForm } from "@/lib/credentials.mjs";
import { defineMessages, useMessages } from "@/lib/i18n";

/**
 * The form of one credential, shared by the first-project and credentials guides and the
 * workbench. Its secrets stay in component state only: a guide's draft is kept in the browser to
 * be resumed, and a secret must never be part of it. Once saved, the API encrypts every secret
 * and never returns it; what each kind requires and how the body is built is in
 * `lib/credentials.mjs`.
 */

export { CREDENTIAL_KINDS, EMPTY_CREDENTIAL, type CredentialForm };

const MESSAGES = defineMessages({
  es: {
    kinds: {
      bearer: ["Token bearer", "Authorization: Bearer <token>. Un JWT o un token opaco."],
      api_key: ["API key", "Una clave en una cabecera propia (X-API-Key por defecto)."],
      basic: ["Basic", "Usuario y contraseña en Authorization: Basic."],
      oauth2_client_credentials: ["OAuth2 client credentials", "El API pide el token al servidor de autorización una vez por corrida y lo renueva solo."],
      oauth2_authorization_code: ["OAuth2 authorization code", "Pegas un refresh token: el API lo cambia por access tokens, los renueva y guarda el refresh token que rote."],
      cookie: ["Cookie de sesión", "Una cookie pegada, o un login cuyo Set-Cookie se reenvía (y se repite tras un 401)."],
      hmac: ["Firma HMAC", "Cada solicitud firmada con una clave compartida: método, ruta, hora y hash del cuerpo."],
      mtls: ["Certificado de cliente (mTLS)", "Un certificado y su clave privada, presentados en el handshake TLS."],
    } as Record<CredentialKind, [string, string]>,
    token: "Token", key: "Clave", password: "Contraseña", clientSecret: "Client secret", clientSecretOptional: "Client secret (opcional en clientes públicos)", header: "Cabecera", headerHint: "Vacío = la del proyecto (auth.apiKeyHeader).", username: "Usuario",
    tokenUrl: "URL del token", clientId: "Client id", scope: "Scope (opcional)", secretHint: "Se cifra al guardarse y nunca vuelve al navegador.", keep: "Vacío = conservar el guardado.",
    refreshToken: "Refresh token", refreshHint: "La autorización interactiva (redirección del navegador, PKCE) no está incluida: obtén el refresh token con las herramientas de tu proveedor de identidad (un login único, por ejemplo) y pégalo aquí.",
    cookieSession: "Cookie pegada", cookieLogin: "Login", cookieName: "Nombre de la cookie", cookieValue: "Valor de la cookie",
    loginMethod: "Método", loginPath: "Ruta del login", loginPathHint: "Relativa a la URL base del entorno, o una URL absoluta.", loginBody: "Cuerpo", loginBodyHint: "{{username}} y {{password}} se reemplazan con el usuario y la contraseña.", contentType: "Content-Type", loginUser: "Usuario (opcional)", loginPassword: "Contraseña (opcional)",
    hmacKey: "Clave HMAC", algorithm: "Algoritmo", encoding: "Codificación", signatureHeader: "Cabecera de la firma", keyId: "Key id (opcional)", keyIdHeader: "Cabecera del key id", timestampHeader: "Cabecera de la hora (segundos Unix)",
    template: "Texto a firmar", templateHint: `\\n es un salto de línea. Marcadores: ${HMAC_PLACEHOLDERS.map((name) => `{${name}}`).join(" ")} ({path} incluye la query; {bodyHash}, el hash hex del cuerpo con el mismo algoritmo).`, unknown: (names: string[]) => `Marcadores desconocidos: ${names.join(", ")}`,
    tlsTitle: "Certificado de cliente (mTLS)", tlsOptional: "Opcional: se suma a las cabeceras de esta credencial (bearer + mTLS, por ejemplo).",
    tlsCombinedPrimary: "En la credencial principal el certificado es transporte, no identidad: lo presentan también los casos sin certificado propio, incluido el de «sin credencial» (que prueba la autenticación del API, no el handshake).",
    tlsAlonePrimary: "Aquí el certificado es la identidad: el caso «sin credencial» no presenta ninguno, así que puede seguir esperando un 401.",
    cert: "Certificado (PEM)", privateKey: "Clave privada (PEM)", passphrase: "Frase de la clave (opcional)", ca: "CA del servidor (PEM, opcional)", caHint: "Para confiar en un servidor con un certificado propio.", pickFile: "Desde archivo", keyHint: "Se cifra al guardarse; el API comprueba que sea la pareja del certificado.",
  },
  en: {
    kinds: {
      bearer: ["Bearer token", "Authorization: Bearer <token>. A JWT or an opaque token."],
      api_key: ["API key", "A key in a header of its own (X-API-Key by default)."],
      basic: ["Basic", "Username and password in Authorization: Basic."],
      oauth2_client_credentials: ["OAuth2 client credentials", "The API asks the authorization server for a token once per run and renews it by itself."],
      oauth2_authorization_code: ["OAuth2 authorization code", "You paste a refresh token: the API exchanges it for access tokens, renews them and stores the refresh token when it rotates."],
      cookie: ["Session cookie", "A pasted cookie, or a login whose Set-Cookie is sent back (and repeated after a 401)."],
      hmac: ["HMAC signature", "Each request signed with a shared key: method, path, time and body hash."],
      mtls: ["Client certificate (mTLS)", "A certificate and its private key, presented in the TLS handshake."],
    } as Record<CredentialKind, [string, string]>,
    token: "Token", key: "Key", password: "Password", clientSecret: "Client secret", clientSecretOptional: "Client secret (optional for public clients)", header: "Header", headerHint: "Empty = the project's (auth.apiKeyHeader).", username: "Username",
    tokenUrl: "Token URL", clientId: "Client id", scope: "Scope (optional)", secretHint: "Encrypted when saved, and never comes back to the browser.", keep: "Empty = keep the stored one.",
    refreshToken: "Refresh token", refreshHint: "Interactive authorization (a browser redirect, PKCE) is not included: get the refresh token with your identity provider's tooling (a one-time login, for instance) and paste it here.",
    cookieSession: "Pasted cookie", cookieLogin: "Login", cookieName: "Cookie name", cookieValue: "Cookie value",
    loginMethod: "Method", loginPath: "Login path", loginPathHint: "Relative to the environment's base URL, or an absolute URL.", loginBody: "Body", loginBodyHint: "{{username}} and {{password}} are replaced with the username and password.", contentType: "Content-Type", loginUser: "Username (optional)", loginPassword: "Password (optional)",
    hmacKey: "HMAC key", algorithm: "Algorithm", encoding: "Encoding", signatureHeader: "Signature header", keyId: "Key id (optional)", keyIdHeader: "Key id header", timestampHeader: "Timestamp header (Unix seconds)",
    template: "String to sign", templateHint: `\\n is a line break. Placeholders: ${HMAC_PLACEHOLDERS.map((name) => `{${name}}`).join(" ")} ({path} includes the query; {bodyHash} is the hex hash of the body with the same algorithm).`, unknown: (names: string[]) => `Unknown placeholders: ${names.join(", ")}`,
    tlsTitle: "Client certificate (mTLS)", tlsOptional: "Optional: added to this credential's headers (bearer + mTLS, for instance).",
    tlsCombinedPrimary: "On the primary credential the certificate is transport, not identity: cases without a certificate of their own present it too, the no-credential one included (it tests the API's authentication, not the handshake).",
    tlsAlonePrimary: "Here the certificate is the identity: the no-credential case presents none, so it can still expect a 401.",
    cert: "Certificate (PEM)", privateKey: "Private key (PEM)", passphrase: "Key passphrase (optional)", ca: "Server CA (PEM, optional)", caHint: "To trust a server with a certificate of its own.", pickFile: "From file", keyHint: "Encrypted when saved; the API checks that it pairs with the certificate.",
  },
});

/** Whether nothing was typed, something was but not enough, or the credential can be saved. */
export function credentialState(form: CredentialForm): "empty" | "incomplete" | "complete" {
  if (!credentialTyped(form)) return "empty";
  return credentialDraftOf(form) ? "complete" : "incomplete";
}

/** The credential as the API takes it, or `null` while a required field is missing. A guide carries every secret itself. */
export const credentialDraftOf = (form: CredentialForm) => credentialPayload(form, null);

export function KindPicker({ value, onChange }: { value: CredentialKind; onChange: (kind: CredentialKind) => void }) {
  const t = useMessages(MESSAGES);
  return <RadioCards.Root size="1" value={value} onValueChange={(kind) => onChange(kind as CredentialKind)} columns={{ initial: "1", sm: "2" }} gap="2">{CREDENTIAL_KINDS.map((kind) => <RadioCards.Item key={kind} value={kind} className="justify-start text-left text-[11px]">
    <span><span className="block text-xs font-semibold text-slate-900">{t.kinds[kind][0]}</span><span className="mt-0.5 block text-slate-500">{t.kinds[kind][1]}</span></span>
  </RadioCards.Item>)}</RadioCards.Root>;
}

/** A PEM block typed, pasted or read from a file. Not a `Field`: a file picker inside its label would be a label in a label. */
function PemField({ label, hint, value, onChange, placeholder, size }: { label: string; hint?: ReactNode; value: string; onChange: (value: string) => void; placeholder?: string; size: "1" | "2" }) {
  const t = useMessages(MESSAGES);
  const id = useId();
  return <div className="text-[11px] font-medium text-slate-600 sm:col-span-2">
    <div className="flex items-center justify-between gap-2"><label htmlFor={id}>{label}</label>
      <Button asChild size="1" variant="ghost" color="gray"><label className="cursor-pointer"><FileUp className="size-3"/>{t.pickFile}<input type="file" accept=".pem,.crt,.cer,.key,text/plain" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onChange(await file.text()); }}/></label></Button>
    </div>
    {/* A private key is a secret: never spell-checked (a browser may send the text to a service for that). */}
    <TextArea id={id} size={size} rows={4} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder ?? "-----BEGIN …-----"} spellCheck={false} autoComplete="off" className="mt-1 font-mono text-[10px] leading-4"/>
    {hint && <span className="mt-1 block text-[11px] font-normal leading-4 text-slate-500">{hint}</span>}
  </div>;
}

/** The client certificate: required for `mtls`, an optional section under any other kind. */
function CertificateFields({ value, set, stored, credentialRole, size }: { value: CredentialForm; set: (patch: Partial<CredentialForm>) => void; stored?: CredentialView; credentialRole?: string; size: "1" | "2" }) {
  const t = useMessages(MESSAGES);
  const alone = value.kind === "mtls";
  const keyHint = stored?.secretHints?.tlsKey;
  const fields = <div className="grid gap-3 sm:grid-cols-2">
    <PemField size={size} label={t.cert} value={value.tlsCert} onChange={(tlsCert) => set({ tlsCert })} placeholder="-----BEGIN CERTIFICATE-----"/>
    <PemField size={size} label={t.privateKey} value={value.tlsKey} onChange={(tlsKey) => set({ tlsKey })} placeholder={keyHint ? `${keyHint} · ${t.keep}` : "-----BEGIN PRIVATE KEY-----"} hint={t.keyHint}/>
    <Field label={t.passphrase} hint={stored?.secretHints?.tlsPassphrase ? t.keep : undefined} className="sm:col-span-2"><TextField.Root size={size} type="password" autoComplete="new-password" value={value.tlsPassphrase} placeholder={stored?.secretHints?.tlsPassphrase} onChange={(event) => set({ tlsPassphrase: event.target.value })} className="mt-1 font-mono"/></Field>
    <PemField size={size} label={t.ca} hint={t.caHint} value={value.tlsCa} onChange={(tlsCa) => set({ tlsCa })} placeholder="-----BEGIN CERTIFICATE-----"/>
    {/* Who presents the primary's certificate depends on whether it is the identity or only its transport. */}
    {credentialRole === "primary" && <p className="text-[11px] leading-4 text-slate-500 sm:col-span-2">{alone ? t.tlsAlonePrimary : t.tlsCombinedPrimary}</p>}
  </div>;
  if (alone) return <div className="sm:col-span-2">{fields}</div>;
  // Open by itself when a certificate is already there, so a saved one is never hidden.
  return <details open={Boolean(value.tlsCert) || undefined} className="rounded-lg border border-slate-200 px-3 py-2 sm:col-span-2">
    <summary className="cursor-pointer text-[11px] font-semibold text-slate-700">{t.tlsTitle} <span className="font-normal text-slate-500">· {t.tlsOptional}</span></summary>
    <div className="mt-2">{fields}</div>
  </details>;
}

/**
 * The fields of the chosen kind. With `stored` (the credential as listed) an empty secret keeps
 * the saved one, and its hint is the placeholder; `credentialRole` explains who presents a certificate.
 */
export function ValueFields({ value, onChange, stored, credentialRole, size = "2", apiKeyHeader = "X-API-Key" }: { value: CredentialForm; onChange: (value: CredentialForm) => void; stored?: CredentialView; credentialRole?: string; size?: "1" | "2"; apiKeyHeader?: string }) {
  const t = useMessages(MESSAGES);
  const set = (patch: Partial<CredentialForm>) => onChange({ ...value, ...patch });
  const text = (field: keyof CredentialForm, label: string, extra: { hint?: ReactNode; placeholder?: string; type?: "url"; wide?: boolean } = {}) => <Field label={label} hint={extra.hint} className={extra.wide ? "sm:col-span-2" : undefined}><TextField.Root size={size} type={extra.type} autoComplete="off" value={value[field]} placeholder={extra.placeholder} onChange={(event) => set({ [field]: event.target.value })} className="mt-1 font-mono"/></Field>;
  // `new-password` keeps the browser from offering a saved password for this field.
  const secret = (label: string, field: "secret" | "refreshToken" = "secret", hint: ReactNode = t.secretHint, wide = false) => {
    const saved = field === "secret" ? stored?.hasSecret ? `····${stored.lastFour ?? ""}` : "" : stored?.secretHints?.refreshToken ? `····${stored.secretHints.refreshToken}` : "";
    return <Field label={label} hint={saved ? <>{hint} {t.keep}</> : hint} className={wide ? "sm:col-span-2" : undefined}><TextField.Root size={size} type="password" autoComplete="new-password" value={value[field]} placeholder={saved || undefined} onChange={(event) => set({ [field]: event.target.value })} className="mt-1 font-mono"/></Field>;
  };
  const choose = <T extends string>(label: string, current: T, options: readonly T[], pick: (value: T) => void) => <Field label={label}><Select.Root size={size} value={current} onValueChange={(item) => pick(item as T)}><Select.Trigger className="mt-1 w-full font-mono"/><Select.Content>{options.map((item) => <Select.Item key={item} value={item}>{item}</Select.Item>)}</Select.Content></Select.Root></Field>;
  const unknown = value.kind === "hmac" ? unknownPlaceholders(value.hmacTemplate) : [];
  return <div className="grid gap-3 sm:grid-cols-2">
    {value.kind === "bearer" && secret(t.token, "secret", t.secretHint, true)}
    {value.kind === "api_key" && <>{text("headerName", t.header, { hint: t.headerHint, placeholder: apiKeyHeader })}{secret(t.key)}</>}
    {value.kind === "basic" && <>{text("username", t.username)}{secret(t.password)}</>}
    {(value.kind === "oauth2_client_credentials" || value.kind === "oauth2_authorization_code") && <>
      {text("tokenUrl", t.tokenUrl, { type: "url", placeholder: "https://auth.example.com/oauth/token", wide: true })}
      {text("clientId", t.clientId)}
      {text("scope", t.scope, { placeholder: "orders:read orders:write" })}
      {value.kind === "oauth2_authorization_code" && secret(t.refreshToken, "refreshToken", t.refreshHint, true)}
      {secret(value.kind === "oauth2_authorization_code" ? t.clientSecretOptional : t.clientSecret, "secret", t.secretHint, true)}
    </>}
    {value.kind === "cookie" && <>
      <div className="sm:col-span-2"><SegmentedControl.Root size="1" value={value.cookieMode} onValueChange={(mode) => set({ cookieMode: mode as CredentialForm["cookieMode"], ...(mode === "login" && !value.loginBody ? { loginBody: LOGIN_BODY_TEMPLATE } : {}) })}>
        <SegmentedControl.Item value="session">{t.cookieSession}</SegmentedControl.Item><SegmentedControl.Item value="login">{t.cookieLogin}</SegmentedControl.Item>
      </SegmentedControl.Root></div>
      {value.cookieMode === "session" ? <>{text("cookieName", t.cookieName, { placeholder: "session" })}{secret(t.cookieValue)}</> : <>
        {choose(t.loginMethod, value.loginMethod, ["POST", "PUT", "PATCH", "GET"] as const, (loginMethod) => set({ loginMethod }))}
        {text("loginPath", t.loginPath, { hint: t.loginPathHint, placeholder: "/auth/login" })}
        <Field label={t.loginBody} hint={t.loginBodyHint} className="sm:col-span-2"><TextArea size={size} rows={3} value={value.loginBody} onChange={(event) => set({ loginBody: event.target.value })} spellCheck={false} className="mt-1 font-mono text-[11px] leading-5"/></Field>
        {text("loginContentType", t.contentType, { placeholder: "application/json", wide: true })}
        {text("username", t.loginUser)}{secret(t.loginPassword)}
      </>}
    </>}
    {value.kind === "hmac" && <>
      {secret(t.hmacKey, "secret", t.secretHint, true)}
      {choose(t.algorithm, value.hmacAlgorithm, ["sha256", "sha512"] as const, (hmacAlgorithm) => set({ hmacAlgorithm }))}
      {choose(t.encoding, value.hmacEncoding, ["hex", "base64"] as const, (hmacEncoding) => set({ hmacEncoding }))}
      {text("hmacHeader", t.signatureHeader, { placeholder: "X-Signature" })}
      {text("hmacTimestampHeader", t.timestampHeader, { placeholder: "X-Timestamp" })}
      {text("hmacKeyId", t.keyId)}
      {text("hmacKeyIdHeader", t.keyIdHeader, { placeholder: "X-Key-Id" })}
      {text("hmacTemplate", t.template, { hint: unknown.length ? <span className="text-rose-600">{t.unknown(unknown)}</span> : t.templateHint, placeholder: HMAC_DEFAULT_TEMPLATE, wide: true })}
    </>}
    <CertificateFields value={value} set={set} stored={stored} credentialRole={credentialRole} size={size}/>
  </div>;
}

/** Kind and value together, for the guide that asks for both on one step. */
export function CredentialFields({ value, onChange }: { value: CredentialForm; onChange: (value: CredentialForm) => void }) {
  return <div className="space-y-4">
    <KindPicker value={value.kind} onChange={(kind) => onChange({ ...value, kind })}/>
    <ValueFields value={value} onChange={onChange} credentialRole="primary"/>
  </div>;
}
