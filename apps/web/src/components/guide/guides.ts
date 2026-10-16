/**
 * The step-by-step guides: their ids (as they appear in `?vista=guia&guia=<id>`), what each one
 * is for, the documentation page behind it and the names of its steps. The step names live
 * here rather than in each guide so the landing and the stepper read from the same list.
 */
import { CloudUpload, Gauge, KeyRound, ListChecks, Rocket, Server, Timer, type LucideIcon } from "lucide-react";

export type GuideId = "first-project" | "environment" | "credentials" | "functional" | "budgets" | "load" | "sync";
type Text = { es: string; en: string };
export type GuideEntry = { id: GuideId; icon: LucideIcon; title: Text; summary: Text; doc: string; needsProject: boolean; steps: Text[] };

export const GUIDES: GuideEntry[] = [
  {
    id: "first-project", icon: Rocket, doc: "inicio", needsProject: false,
    title: { es: "Nuevo proyecto", en: "New project" },
    summary: { es: "Del contrato OpenAPI a una verificación de solo lectura, con un entorno y su credencial.", en: "From the OpenAPI contract to a read-only check, with an environment and its credential." },
    steps: [
      { es: "Nombre", en: "Name" }, { es: "Contrato", en: "Contract" }, { es: "Operaciones", en: "Operations" },
      { es: "Entorno", en: "Environment" }, { es: "Credencial", en: "Credential" }, { es: "Primera corrida", en: "First run" },
    ],
  },
  {
    id: "environment", icon: Server, doc: "conceptos", needsProject: true,
    title: { es: "Entorno", en: "Environment" },
    summary: { es: "Dónde corre la API y qué se permite allí: seed, escrituras, presupuestos y autenticación.", en: "Where the API runs and what is allowed there: seed, writes, budgets and authentication." },
    steps: [
      { es: "Dirección", en: "Address" }, { es: "Seed", en: "Seed" }, { es: "Escrituras", en: "Writes" },
      { es: "Latencia", en: "Latency" }, { es: "Autenticación", en: "Authentication" }, { es: "Guardar", en: "Save" },
    ],
  },
  {
    id: "credentials", icon: KeyRound, doc: "conceptos", needsProject: true,
    title: { es: "Credenciales", en: "Credentials" },
    summary: { es: "Bearer, API key, Basic u OAuth2, con su rol, probadas contra una operación protegida.", en: "Bearer, API key, Basic or OAuth2, with their role, tested against a protected operation." },
    steps: [{ es: "Tipo", en: "Kind" }, { es: "Valor", en: "Value" }, { es: "Rol", en: "Role" }, { es: "Probar", en: "Test" }],
  },
  {
    id: "functional", icon: ListChecks, doc: "funcional", needsProject: true,
    title: { es: "Casos funcionales", en: "Functional cases" },
    summary: { es: "Generar desde el schema, ajustar samples y bodies, plugins y vista previa de la matriz.", en: "Generate from the schema, tune samples and bodies, plugins and a preview of the matrix." },
    steps: [
      { es: "Generar", en: "Generate" }, { es: "Samples", en: "Samples" }, { es: "Bodies", en: "Bodies" },
      { es: "Flujos", en: "Flows" }, { es: "Plugins", en: "Plugins" }, { es: "Matriz", en: "Matrix" },
    ],
  },
  {
    id: "budgets", icon: Timer, doc: "conceptos", needsProject: true,
    title: { es: "Presupuestos de latencia", en: "Latency budgets" },
    summary: { es: "Reglas ordenadas con una vista previa en vivo de qué operación cae en cada una.", en: "Ordered rules with a live preview of which operation falls under each one." },
    steps: [{ es: "Cómo funcionan", en: "How they work" }, { es: "Reglas", en: "Rules" }, { es: "Guardar", en: "Save" }],
  },
  {
    id: "load", icon: Gauge, doc: "carga", needsProject: true,
    title: { es: "Prueba de carga", en: "Load test" },
    summary: { es: "Tipo de prueba, mezcla de operaciones, etapas con su gráfico, umbrales y arranque.", en: "Test type, operation mix, stages with their chart, thresholds and start." },
    steps: [
      { es: "Tipo", en: "Type" }, { es: "Mezcla", en: "Mix" }, { es: "Etapas", en: "Stages" },
      { es: "Umbrales", en: "Thresholds" }, { es: "Ejecutar", en: "Run" },
    ],
  },
  {
    id: "sync", icon: CloudUpload, doc: "sync", needsProject: false,
    title: { es: "Sincronización", en: "Sync" },
    summary: { es: "Enlazar esta instalación a un workspace en la nube, elegir qué viaja y, si quieres, las credenciales cifradas.", en: "Link this installation to a cloud workspace, choose what travels and, if you want, the encrypted credentials." },
    steps: [
      { es: "Nube", en: "Cloud" }, { es: "Enlazar", en: "Link" }, { es: "Qué sincronizar", en: "What to sync" },
      { es: "Secretos", en: "Secrets" }, { es: "Sincronizar", en: "Sync" },
    ],
  },
];

export const guideById = (id: string) => GUIDES.find((guide) => guide.id === id);
