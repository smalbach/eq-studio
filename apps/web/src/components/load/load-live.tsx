import { Activity } from "lucide-react";
import { Badge, Progress, Spinner } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { LoadCharts } from "@/components/load/load-report";
import type { LoadRunner } from "@/components/load/use-load-runner";
import { defineMessages, useIntlLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { running: "Prueba en curso", noVerdict: "Prueba sin veredicto", sent: (n: string) => `${n} enviadas`, errors: (n: number) => `${n} errores`, inFlight: (n: number) => `${n} en vuelo` },
  en: { running: "Test running", noVerdict: "Test without a verdict", sent: (n: string) => `${n} sent`, errors: (n: number) => `${n} errors`, inFlight: (n: number) => `${n} in flight` },
});

/** The test in flight, one window per second: progress, live numbers and the four charts. */
export function LoadLive({ load }: { load: LoadRunner }) {
  const t = useMessages(MESSAGES);
  const intl = useIntlLocale();
  const { running, windows, duration, lastRun } = load;
  if (!running && (lastRun || !windows.length)) return null;
  const live = windows.at(-1);
  const sent = windows.reduce((sum, window) => sum + (window.sent ?? 0), 0);
  const errors = windows.reduce((sum, window) => sum + window.errors, 0);
  const completed = windows.reduce((sum, window) => sum + window.completed, 0);
  return <Card className="p-5" aria-live="polite">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold">{running ? <Spinner size="2" className="text-accent-11"/> : <Activity className="size-4 text-slate-400"/>}{running ? t.running : t.noVerdict}<InfoTip id="liveProgress"/></p>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <Badge size="1" radius="full" variant="soft" color="gray">{live ? `${live.t} / ${duration} s` : `0 / ${duration} s`}</Badge>
        <Badge size="1" radius="full" variant="soft" color="gray" className="font-mono">{t.sent(sent.toLocaleString(intl))}</Badge>
        <Badge size="1" radius="full" variant="soft" color="sky" className="font-mono">{live ? `${live.rps.toFixed(0)} / ${live.targetRps ?? "—"} req/s` : "— req/s"}</Badge>
        <Badge size="1" radius="full" variant="soft" color="violet" className="font-mono">p95 {live ? `${live.p95} ms` : "—"}</Badge>
        <Badge size="1" radius="full" variant="soft" color={errors ? "ruby" : "gray"} className="font-mono">{t.errors(errors)}{completed ? ` (${((errors / completed) * 100).toFixed(2)} %)` : ""}</Badge>
        <Badge size="1" radius="full" variant="soft" color="gray" className="font-mono">{t.inFlight(live?.inFlight ?? 0)}</Badge>
      </div>
    </div>
    <Progress size="1" value={Math.min(100, ((live?.t ?? 0) / duration) * 100)} className="mt-3"/>
    <div className="mt-5"><LoadCharts windows={windows} budget={load.budget}/></div>
  </Card>;
}
