import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, Callout, Spinner, TextField } from "@radix-ui/themes";
import { CircleAlert } from "lucide-react";
import { DeviceApproval } from "@/components/account/device-approval";
import { Shell } from "@/components/account/shell";
import { API, ApiError } from "@/lib/api";
import { deviceCode } from "@/lib/sync.mjs";
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
  },
  en: {
    checking: "Checking the session…", signIn: "Sign in", register: "Create the first account", accept: "Accept the invitation",
    email: "Email", password: "Password", name: "Name", workspace: "Workspace name", submit: "Sign in", create: "Create account", join: "Join",
    firstHint: "Only the first account registers here, as the owner. Everyone after it arrives by invitation.",
    inviteHint: "If you already have an account with this email, use your password; otherwise choose one (at least 10 characters).",
    noAccount: "A new installation?", haveAccount: "Already have an account?",
  },
});

/** Sign in, the first account, or an invitation — whichever the URL and the deployment call for. */
function SignIn({ registration, invitation }: { registration: "open" | "invite"; invitation: string | null }) {
  const t = useMessages(MESSAGES);
  // `?registro` comes from a local installation's "Create an account in the cloud".
  const [mode, setMode] = useState<"login" | "register">(() => new URLSearchParams(window.location.search).has("registro") ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const session = invitation ? await API.acceptInvitation(invitation, password, name || undefined) : mode === "login" ? await API.login(email, password) : await API.register({ email, password, name, workspace: workspace || undefined });
      if (invitation) window.history.replaceState(null, "", window.location.pathname);
      signedIn(session);
    } catch (failure) { setError(failure instanceof ApiError ? failure.full : String(failure)); } finally { setBusy(false); }
  };
  const title = invitation ? t.accept : mode === "login" ? t.signIn : t.register;
  return <Shell><form onSubmit={submit} className="grid gap-3">
    <p className="text-base font-semibold">{title}</p>
    {invitation && <p className="text-[11px] leading-5 text-slate-500">{t.inviteHint}</p>}
    {mode === "register" && !invitation && <p className="text-[11px] leading-5 text-slate-500">{t.firstHint}</p>}
    {!invitation && <label className="text-[11px] text-slate-500">{t.email}<TextField.Root size="3" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1"/></label>}
    {(mode === "register" || invitation) && <label className="text-[11px] text-slate-500">{t.name}<TextField.Root size="3" required={mode === "register" && !invitation} value={name} onChange={(event) => setName(event.target.value)} className="mt-1"/></label>}
    {mode === "register" && !invitation && <label className="text-[11px] text-slate-500">{t.workspace}<TextField.Root size="3" value={workspace} onChange={(event) => setWorkspace(event.target.value)} className="mt-1"/></label>}
    <label className="text-[11px] text-slate-500">{t.password}<TextField.Root size="3" type="password" required autoComplete={mode === "login" && !invitation ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1"/></label>
    {error && <Callout.Root size="1" color="red" role="alert"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="whitespace-pre-line">{error}</Callout.Text></Callout.Root>}
    <Button type="submit" size="3" loading={busy} className="mt-1">{invitation ? t.join : mode === "login" ? t.submit : t.create}</Button>
    {!invitation && <Button type="button" size="1" variant="ghost" color="gray" onClick={() => setMode(mode === "login" ? "register" : "login")} className={cn("mx-auto", registration === "invite" && mode === "login" && "opacity-80")}>{mode === "login" ? t.noAccount : t.haveAccount} <span className="font-semibold text-accent-11">{mode === "login" ? t.register : t.signIn}</span></Button>}
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
  const invitation = new URLSearchParams(window.location.search).get("invitacion");
  // `?device=` comes from a local installation signing in from the browser (cloud only).
  const [device, setDevice] = useState(() => deviceCode(new URLSearchParams(window.location.search).get("device")));
  useEffect(() => {
    void (async () => {
      try {
        const health = await API.health();
        setRegistration(health.registration);
        if (health.auth === "none") { localMode(); return; }
        if (invitation) { signedOut(); return; }
        await refreshSession();
      } catch { localMode(); }
    })();
  }, [invitation]);
  // A cache per session and workspace: nothing read in one shows in another, and the tree below
  // starts with an empty cache instead of one being cleared under it.
  const scope = `${session.status}:${session.workspaceId ?? "local"}`;
  const queries = useMemo(() => { void scope; return newQueryClient(); }, [scope]);
  if (session.status === "checking") return <main className="grid min-h-screen place-items-center bg-background text-foreground"><p className="flex items-center gap-2 text-sm text-slate-500"><Spinner size="2"/>{t.checking}</p></main>;
  if (session.status === "signed-out") return <SignIn registration={registration} invitation={invitation}/>;
  const approving = session.status === "signed-in" && device;
  return <QueryClientProvider key={scope} client={queries}>{approving ? <DeviceApproval code={device} onContinue={() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("device");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setDevice(null);
  }}/> : children}</QueryClientProvider>;
}
