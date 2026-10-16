import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, Callout, Spinner, TextField } from "@radix-ui/themes";
import { CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { DeviceApproval } from "@/components/account/device-approval";
import { Shell } from "@/components/account/shell";
import { API, ApiError } from "@/lib/api";
import { deviceCode } from "@/lib/sync.mjs";
import { resetTokenOf } from "@/lib/audit.mjs";
import { localMode, refreshSession, signedIn, signedOut, useSession } from "@/lib/session";
import { defineMessages, useMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MESSAGES = defineMessages({
  es: {
    checking: "Comprobando la sesión…", signIn: "Iniciar sesión", register: "Crear la primera cuenta", accept: "Aceptar la invitación",
    email: "Correo", password: "Contraseña", name: "Nombre", workspace: "Nombre del workspace", submit: "Entrar", create: "Crear cuenta", join: "Unirme",
    firstHint: "Solo la primera cuenta se registra aquí y queda como propietaria. Las siguientes llegan por invitación.",
    inviteHint: "Si ya tienes cuenta con este correo, usa tu contraseña; si no, elige una (al menos 10 caracteres).",
    noAccount: "¿Es una instalación nueva?", haveAccount: "¿Ya tienes cuenta?",
    forgot: "¿Olvidaste la contraseña?", forgotTitle: "Restablecer la contraseña", forgotHint: "Escribe el correo de tu cuenta y te enviaremos un enlace para elegir otra contraseña.", send: "Enviar el enlace",
    forgotSent: "Si hay una cuenta con ese correo, le llegará un enlace en unos minutos. Vale 30 minutos y se usa una sola vez.",
    resetTitle: "Elige una contraseña nueva", resetHint: "Al menos 10 caracteres. Al cambiarla se cierran todas las sesiones abiertas de la cuenta.", newPassword: "Contraseña nueva", repeat: "Repítela", save: "Guardar la contraseña",
    mismatch: "Las dos contraseñas no coinciden.", resetDone: "Contraseña cambiada. Inicia sesión con la nueva.", backToSignIn: "Volver a iniciar sesión",
    or: "o", sso: (name: string) => `Entrar con ${name}`,
    ssoError: { unverified: "El proveedor no confirmó un correo verificado para tu cuenta.", domain: "El dominio de tu correo no tiene acceso a esta instalación.", not_invited: "Aún no tienes acceso: pide a un administrador que invite tu correo.", disabled: "Esta cuenta está desactivada.", expired: "El inicio de sesión tardó demasiado o se abrió en otra pestaña. Inténtalo de nuevo.", failed: "No se pudo completar el inicio de sesión con el proveedor. Inténtalo de nuevo." } as Record<string, string>,
  },
  en: {
    checking: "Checking the session…", signIn: "Sign in", register: "Create the first account", accept: "Accept the invitation",
    email: "Email", password: "Password", name: "Name", workspace: "Workspace name", submit: "Sign in", create: "Create account", join: "Join",
    firstHint: "Only the first account registers here, as the owner. Everyone after it arrives by invitation.",
    inviteHint: "If you already have an account with this email, use your password; otherwise choose one (at least 10 characters).",
    noAccount: "A new installation?", haveAccount: "Already have an account?",
    forgot: "Forgot your password?", forgotTitle: "Reset your password", forgotHint: "Type your account's email and we will send you a link to choose another password.", send: "Send the link",
    forgotSent: "If there is an account with that email, a link will arrive in a few minutes. It is valid for 30 minutes and works once.",
    resetTitle: "Choose a new password", resetHint: "At least 10 characters. Changing it closes every open session of the account.", newPassword: "New password", repeat: "Repeat it", save: "Save the password",
    mismatch: "The two passwords do not match.", resetDone: "Password changed. Sign in with the new one.", backToSignIn: "Back to sign in",
    or: "or", sso: (name: string) => `Sign in with ${name}`,
    ssoError: { unverified: "The provider did not confirm a verified email for your account.", domain: "Your email's domain has no access to this installation.", not_invited: "You have no access yet: ask an administrator to invite your email.", disabled: "This account is disabled.", expired: "The sign-in took too long or was opened in another tab. Try again.", failed: "The sign-in with the provider could not be completed. Try again." } as Record<string, string>,
  },
});

type Mode = "login" | "register" | "forgot" | "reset";

/** Removes a one-time parameter from the address bar, so a reload does not repeat it. */
function forget(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Sign in, the first account, an invitation, or a forgotten password — whichever the URL and the deployment call for. */
function SignIn({ registration, invitation, sso, resetToken }: { registration: "open" | "invite"; invitation: string | null; sso: { name: string } | null; resetToken: string | null }) {
  const t = useMessages(MESSAGES);
  // `?registro` comes from a local installation's "Create an account in the cloud".
  const [mode, setMode] = useState<Mode>(() => resetToken ? "reset" : new URLSearchParams(window.location.search).has("registro") ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  // A refused single sign-on comes back as `?sso_error=<code>`.
  const [error, setError] = useState(() => { const code = new URLSearchParams(window.location.search).get("sso_error"); return code ? t.ssoError[code] ?? t.ssoError.failed : ""; });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).has("sso_error")) forget("sso_error"); }, []);
  const go = (next: Mode) => { setMode(next); setError(""); setPassword(""); setRepeat(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "forgot") { await API.forgotPassword(email); setNotice(t.forgotSent); return; }
      if (mode === "reset") {
        if (password !== repeat) { setError(t.mismatch); return; }
        await API.resetPassword(resetToken!, password);
        forget("restablecer");
        go("login");
        setNotice(t.resetDone);
        return;
      }
      const session = invitation ? await API.acceptInvitation(invitation, password, name || undefined) : mode === "login" ? await API.login(email, password) : await API.register({ email, password, name, workspace: workspace || undefined });
      if (invitation) window.history.replaceState(null, "", window.location.pathname);
      signedIn(session);
    } catch (failure) { setError(failure instanceof ApiError ? failure.full : String(failure)); } finally { setBusy(false); }
  };
  const title = invitation ? t.accept : { login: t.signIn, register: t.register, forgot: t.forgotTitle, reset: t.resetTitle }[mode];
  const field = (label: string, input: React.ReactNode) => <label className="text-[11px] text-slate-500">{label}{input}</label>;
  const passwords = mode === "login" || mode === "register" || Boolean(invitation);
  return <Shell><form onSubmit={submit} className="grid gap-3">
    <p className="text-base font-semibold">{title}</p>
    {invitation && <p className="text-[11px] leading-5 text-slate-500">{t.inviteHint}</p>}
    {mode === "register" && !invitation && <p className="text-[11px] leading-5 text-slate-500">{t.firstHint}</p>}
    {mode === "forgot" && <p className="text-[11px] leading-5 text-slate-500">{t.forgotHint}</p>}
    {mode === "reset" && <p className="text-[11px] leading-5 text-slate-500">{t.resetHint}</p>}
    {!invitation && mode !== "reset" && field(t.email, <TextField.Root size="3" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1"/>)}
    {(mode === "register" || invitation) && field(t.name, <TextField.Root size="3" required={mode === "register" && !invitation} value={name} onChange={(event) => setName(event.target.value)} className="mt-1"/>)}
    {mode === "register" && !invitation && field(t.workspace, <TextField.Root size="3" value={workspace} onChange={(event) => setWorkspace(event.target.value)} className="mt-1"/>)}
    {passwords && field(t.password, <TextField.Root size="3" type="password" required autoComplete={mode === "login" && !invitation ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1"/>)}
    {mode === "reset" && <>
      {field(t.newPassword, <TextField.Root size="3" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1"/>)}
      {field(t.repeat, <TextField.Root size="3" type="password" required minLength={10} autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} className="mt-1"/>)}
    </>}
    {error && <Callout.Root size="1" color="red" role="alert"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}
    {notice && <Callout.Root size="1" color="green" role="status"><Callout.Icon><CircleCheck className="size-4"/></Callout.Icon><Callout.Text>{notice}</Callout.Text></Callout.Root>}
    <Button type="submit" size="3" loading={busy} className="mt-1">{invitation ? t.join : { login: t.submit, register: t.create, forgot: t.send, reset: t.save }[mode]}</Button>
    {mode === "login" && !invitation && <Button type="button" size="1" variant="ghost" color="gray" onClick={() => go("forgot")} className="mx-auto">{t.forgot}</Button>}
    {sso && (mode === "login" || invitation) && <>
      <p className="flex items-center gap-2 text-[11px] text-slate-400 before:h-px before:flex-1 before:bg-slate-200 after:h-px after:flex-1 after:bg-slate-200">{t.or}</p>
      {/* A full navigation: the provider's page, then back through the API's callback. */}
      <Button asChild size="3" variant="surface" color="gray"><a href="/v1/auth/oidc/start"><KeyRound className="size-4"/>{t.sso(sso.name)}</a></Button>
    </>}
    {(mode === "forgot" || mode === "reset") && <Button type="button" size="1" variant="ghost" color="gray" onClick={() => go("login")} className="mx-auto">{t.backToSignIn}</Button>}
    {!invitation && (mode === "login" || mode === "register") && <Button type="button" size="1" variant="ghost" color="gray" onClick={() => go(mode === "login" ? "register" : "login")} className={cn("mx-auto", registration === "invite" && mode === "login" && "opacity-80")}>{mode === "login" ? t.noAccount : t.haveAccount} <span className="font-semibold text-accent-11">{mode === "login" ? t.register : t.signIn}</span></Button>}
  </form></Shell>;
}

export const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 } } });

/**
 * Decides what the app shows before anything else: locally, the app itself; in a hosted
 * deployment, the sign-in screen until there is a session. The dashboard is remounted, with a
 * cache of its own, whenever the session or the workspace changes.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const t = useMessages(MESSAGES);
  const session = useSession();
  const [registration, setRegistration] = useState<"open" | "invite">("invite");
  const [sso, setSso] = useState<{ name: string } | null>(null);
  const invitation = new URLSearchParams(window.location.search).get("invitacion");
  // `?restablecer=` is a password reset link from an email or an administrator.
  const resetToken = resetTokenOf(window.location.search);
  // `?device=` comes from a local installation signing in from the browser (cloud only).
  const [device, setDevice] = useState(() => deviceCode(new URLSearchParams(window.location.search).get("device")));
  useEffect(() => {
    void (async () => {
      try {
        const health = await API.health();
        setRegistration(health.registration);
        setSso(health.sso ?? null);
        if (health.auth === "none") { localMode(); return; }
        if (invitation || resetToken) { signedOut(); return; }
        await refreshSession();
      } catch { localMode(); }
    })();
  }, [invitation, resetToken]);
  // A cache per session and workspace: nothing read in one shows in another, and the tree below
  // starts with an empty cache instead of one being cleared under it.
  const scope = `${session.status}:${session.workspaceId ?? "local"}`;
  const queries = useMemo(() => { void scope; return newQueryClient(); }, [scope]);
  if (session.status === "checking") return <main className="grid min-h-screen place-items-center bg-background text-foreground"><p className="flex items-center gap-2 text-sm text-slate-500"><Spinner size="2"/>{t.checking}</p></main>;
  if (session.status === "signed-out") return <SignIn registration={registration} invitation={invitation} sso={sso} resetToken={resetToken}/>;
  const approving = session.status === "signed-in" && device;
  return <QueryClientProvider key={scope} client={queries}>{approving ? <DeviceApproval code={device} onContinue={() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("device");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setDevice(null);
  }}/> : children}</QueryClientProvider>;
}
