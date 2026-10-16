import { Activity } from "lucide-react";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { tagline: "Verificación funcional, de carga y de estrés de cualquier API contra su contrato." },
  en: { tagline: "Functional, load and stress verification of any API against its contract." },
});

/** The narrow, centered card of the screens shown before the app: sign-in and device approval. */
export function Shell({ children }: { children: React.ReactNode }) {
  const t = useMessages(MESSAGES);
  return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-emerald-600"><Activity className="size-5 text-white"/></span><div><p className="text-sm font-bold">Endpoint Quality</p><p className="text-[11px] text-slate-500">{t.tagline}</p></div></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </div>
  </main>;
}
