import { useState } from "react";
import { Database, ListChecks, Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, IconButton, Link, RadioCards, Select, Spinner, TextField } from "@radix-ui/themes";
import { InfoTip } from "@/components/info-tip";
import { parseList, type LoadRunner } from "@/components/load/use-load-runner";
import { LOAD_LIMITS, localized, TEST_TYPES } from "@/lib/load.mjs";
import type { TestType } from "@/lib/load-types";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MESSAGES = defineMessages({
  es: {
    catalogIntro: "Todas las operaciones GET del proyecto y las variantes de su configuración de carga. Marca las que quieres en la prueba.",
    selectAll: "Marcar todos", selectNone: "Ninguno",
    path: "Ruta GET", weight: "Peso",
    targetPath: (n: number) => `Ruta del objetivo ${n}`, targetWeight: (n: number) => `Peso del objetivo ${n}`, removeTarget: (n: number) => `Quitar objetivo ${n}`,
    addManual: "Agregar ruta manual",
    testData: "Datos de prueba", seed: "semilla del proyecto", fromHere: "se leen del entorno al iniciar", edited: "editados: se envían tal cual",
    loadEnvData: "Leer del entorno al iniciar",
    values: (n: number) => `${n} valores`, empty: "vacío",
    notFrom: (env: string) => `Estos datos no son de ${env}. Al iniciar se leen de sus listados antes de enviar carga.`,
    noDataFor: (names: string, skip: boolean) => `Sin datos para ${names}: esos objetivos ${skip ? "se omiten" : "fallarán la verificación previa"}.`,
    profile: (n: number) => `Perfil de tráfico · ${n} objetivos`, profileAria: "Perfil de tráfico",
    catalog: (n: number) => `Catálogo de endpoints (${n})`, custom: "Personalizado",
  },
  en: {
    catalogIntro: "Every GET operation in the project and the variants of its load configuration. Tick the ones you want in the test.",
    selectAll: "Select all", selectNone: "None",
    path: "GET path", weight: "Weight",
    targetPath: (n: number) => `Path of target ${n}`, targetWeight: (n: number) => `Weight of target ${n}`, removeTarget: (n: number) => `Remove target ${n}`,
    addManual: "Add a path by hand",
    testData: "Test data", seed: "project seed", fromHere: "read from the environment on start", edited: "edited: sent as typed",
    loadEnvData: "Read from the environment on start",
    values: (n: number) => `${n} values`, empty: "empty",
    notFrom: (env: string) => `This data is not from ${env}. On start it is read from its listings before any load is sent.`,
    noDataFor: (names: string, skip: boolean) => `No data for ${names}: those targets ${skip ? "are skipped" : "will fail the preflight"}.`,
    profile: (n: number) => `Traffic profile · ${n} targets`, profileAria: "Traffic profile",
    catalog: (n: number) => `Endpoint catalog (${n})`, custom: "Custom",
  },
});
const TYPE_INFO = { load: "testLoad", stress: "testStress", spike: "testSpike", soak: "testSoak" } as const;

/** Load, stress, spike or soak: the question the test answers. */
export function TestTypePicker({ load }: { load: LoadRunner }) {
  const locale = useLocale();
  const typeInfo = localized(TEST_TYPES.find((item) => item.id === load.type)!, locale);
  return <>
    <RadioCards.Root size="1" gap="2" columns={{ initial: "1", sm: "2", xl: "4" }} value={load.type} disabled={load.running} onValueChange={(value) => load.chooseType(value as TestType)}>{TEST_TYPES.map((entry) => localized(entry, locale)).map((item) => <RadioCards.Item key={item.id} value={item.id} className="flex-col items-start justify-start p-3 text-left"><span className="block text-xs font-semibold text-slate-800">{item.label}</span><span className="mt-0.5 block text-[11px] font-normal text-slate-500">{item.question}</span></RadioCards.Item>)}</RadioCards.Root>
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500"><InfoTip id={TYPE_INFO[load.type]} className="mt-0.5"/>{typeInfo.hint}</p>
  </>;
}

/** Every GET of the contract, grouped by tag, to tick into a custom profile. */
function Catalog({ load }: { load: LoadRunner }) {
  const t = useMessages(MESSAGES);
  const byTag = load.catalog.reduce<Record<string, typeof load.catalog>>((groups, item) => ({ ...groups, [item.tag]: [...(groups[item.tag] ?? []), item] }), {});
  return <div className="mt-2 rounded-xl border border-accent-6 bg-accent-2 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-slate-600">{t.catalogIntro}</p>
      <div className="flex gap-2 text-[11px]"><Link asChild size="1" weight="medium"><button type="button" disabled={load.running} onClick={() => load.editTargets(() => load.catalog.slice(0, LOAD_LIMITS.maxTargets).map((item) => ({ label: item.label, method: "GET", path: item.path, weight: 1 })))}>{t.selectAll}</button></Link><Link asChild size="1" weight="medium" color="gray"><button type="button" disabled={load.running} onClick={() => load.editTargets(() => [])}>{t.selectNone}</button></Link></div></div>
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{Object.entries(byTag).map(([tag, items]) => <div key={tag}><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{tag}</p>
      {items.map((item) => { const checked = load.targets.some((target) => target.path === item.path); return <label key={item.id} aria-label={item.label} htmlFor={`load-catalog-${item.id}`} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-white"><Checkbox id={`load-catalog-${item.id}`} size="1" checked={checked} disabled={load.running || (!checked && load.targets.length >= LOAD_LIMITS.maxTargets)} onCheckedChange={() => load.toggleCatalog(item.path, item.label)} className="mt-0.5"/><span className="min-w-0"><span className="block font-medium text-slate-700">{item.label}</span><span className="block truncate font-mono text-[10px] text-slate-400" title={item.path}>{item.path}</span></span></label>; })}</div>)}</div>
  </div>;
}

/** The routes the test hits and the weight of each. */
function TargetsEditor({ load }: { load: LoadRunner }) {
  const t = useMessages(MESSAGES);
  const { targets, running } = load;
  return <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
    <div className="grid grid-cols-[minmax(0,1fr)_70px_28px] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400"><span className="flex items-center gap-1">{t.path}<InfoTip id="targetPath" size="xs"/></span><span className="flex items-center gap-1">{t.weight}<InfoTip id="targetWeight" size="xs"/></span><span/></div>
    <div className="max-h-80 overflow-y-auto">{targets.map((target, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_70px_28px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 last:border-b-0">
      <TextField.Root size="1" aria-label={t.targetPath(index + 1)} value={target.path} disabled={running} onChange={(event) => load.updateTarget(index, { path: event.target.value, label: `GET ${event.target.value.split("?")[0]}` })} className="min-w-0 font-mono text-[11px]"/>
      <TextField.Root size="1" aria-label={t.targetWeight(index + 1)} type="number" min={0} value={target.weight} disabled={running} onChange={(event) => load.updateTarget(index, { weight: Math.max(0, Number(event.target.value) || 0) })} className="font-mono text-[11px]"/>
      <IconButton size="1" variant="ghost" color="gray" aria-label={t.removeTarget(index + 1)} title={t.removeTarget(index + 1)} disabled={running} onClick={() => load.editTargets((current) => current.filter((_, position) => position !== index))}><Trash2 className="size-3.5"/></IconButton>
    </div>)}</div>
    <Button size="2" variant="ghost" color="gray" radius="none" disabled={running || targets.length >= LOAD_LIMITS.maxTargets} onClick={() => load.editTargets((current) => [...current, { label: "GET /health", method: "GET", path: "/health", weight: 1 }])} className="m-0 w-full justify-start px-3 text-[11px]"><Plus className="size-3.5"/>{t.addManual}</Button>
  </div>;
}

/** The ids and EANs the placeholders draw from: the local seed, or read from the environment. */
function LoadDataFields({ load }: { load: LoadRunner }) {
  const t = useMessages(MESSAGES);
  const { data, dataSource, baseUrl, running, missingData, environmentName } = load;
  return <>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1 text-xs font-semibold text-slate-700">{t.testData}<InfoTip id="loadData" size="xs"/> <span className="font-normal text-slate-400">· {dataSource === "seed" ? t.seed : dataSource === "environment" || dataSource === baseUrl ? t.fromHere : t.edited}</span></p>
      <Button size="1" variant="surface" color="gray" disabled={running || load.loadingData} onClick={() => { load.setError(""); void load.loadEnvironmentData(); }}>{load.loadingData ? <Spinner size="1"/> : <Database className="size-3.5"/>}{t.loadEnvData}</Button></div>
    <div className="mt-2 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{load.dataKeys.map((key) => { const count = parseList(data[key]).length; return <div key={key} className="text-[11px] text-slate-500"><label htmlFor={`load-data-${key}`}><span className="font-mono">{`{${key}}`}</span><span className={cn("ml-1", count ? "text-slate-400" : "text-amber-600")}>· {count ? t.values(count) : t.empty}</span></label>{key.endsWith("_path") && <InfoTip id="dataPath" size="xs" className="ml-1"/>}<TextField.Root id={`load-data-${key}`} size="1" value={data[key] ?? ""} disabled={running} onChange={(event) => { const value = event.target.value; load.setData((current) => ({ ...current, [key]: value })); load.setDataSource("custom"); }} className="mt-1 w-full font-mono text-[11px]"/></div>; })}</div>
    {load.remote && dataSource !== baseUrl && <p className="mt-2 text-[10px] leading-4 text-amber-700">{t.notFrom(environmentName)}</p>}
    {missingData.length > 0 && <p className="mt-2 text-[10px] leading-4 text-amber-700">{t.noDataFor(missingData.map((name) => `{${name}}`).join(", "), load.policy === "skip")}</p>}
  </>;
}

/** What the test sends: the profile, its routes and the data their placeholders draw from. */
export function TrafficProfile({ load }: { load: LoadRunner }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const found = load.mixes.find((item) => item.id === load.mixId);
  const mixInfo = found && localized(found, locale);
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1 text-xs font-semibold text-slate-700">{t.profile(load.targets.length)}<InfoTip id="profile" size="xs"/></p>
      <div className="flex gap-2">
        <Button size="2" variant={catalogOpen ? "soft" : "surface"} color={catalogOpen ? undefined : "gray"} aria-pressed={catalogOpen} disabled={load.running} onClick={() => setCatalogOpen((open) => !open)} className="text-[11px]"><ListChecks className="size-3.5"/>{t.catalog(load.catalog.length)}</Button><InfoTip id="catalog" className="self-center"/>
        <Select.Root size="2" value={load.mixId} disabled={load.running} onValueChange={(value) => load.chooseMix(value)}><Select.Trigger aria-label={t.profileAria} className="text-[11px]"/><Select.Content>{load.mixes.map((mix) => <Select.Item key={mix.id} value={mix.id}>{localized(mix, locale).label}</Select.Item>)}<Select.Item value="custom">{t.custom}</Select.Item></Select.Content></Select.Root>
      </div></div>
    {mixInfo && <p className="mt-1 text-[11px] leading-5 text-slate-500">{mixInfo.hint}</p>}
    {catalogOpen && <Catalog load={load}/>}
    <TargetsEditor load={load}/>
    <LoadDataFields load={load}/>
  </div>;
}
