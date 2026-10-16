/**
 * Endpoint Quality as a desktop app: Electron's main process starts the same local API that
 * `eq serve` runs (SQLite in `~/.endpoint-quality`, shared with the CLI) and shows the web app it
 * serves in a native window. Closing the app stops the API; runs in progress stop with it.
 *
 * If `eq serve` is already running on the default port, the window opens on it instead of starting
 * a second API over the same database file.
 */
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import { startServer, type Server } from "../../cli/src/server.ts";
import { DATA_DIR } from "../../cli/src/runtime.ts";
import { checkForUpdates } from "./updates.ts";

const HOST = "127.0.0.1";
/** The port `eq serve` uses: the same origin keeps the web app's preferences (language, theme). */
const PORT = Number(process.env.EQ_PORT ?? 4400);

let server: Server | undefined;
let origin = "";
let window: BrowserWindow | undefined;

/** A local Endpoint Quality API already answering on this port, if there is one. */
async function runningLocalApi(port: number): Promise<string | undefined> {
  const url = `http://${HOST}:${port}`;
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) });
    const health = (await response.json()) as { status?: string; mode?: string };
    return health.status === "ok" && health.mode === "local" ? url : undefined;
  } catch { return undefined; }
}

async function start(): Promise<string> {
  const running = await runningLocalApi(PORT);
  if (running) return running;
  try {
    server = await startServer({ port: PORT, host: HOST, persistent: true, autoSync: true });
  } catch (error) {
    // The port belongs to something else: any free one will do.
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    server = await startServer({ port: 0, host: HOST, persistent: true, autoSync: true });
  }
  return server.url;
}

function isOwn(url: string) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

/** Links that leave the app (documentation, a spec URL) open in the system browser. */
function openOutside(url: string) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Endpoint Quality",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111113" : "#ffffff",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) return { action: "allow" };
    openOutside(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isOwn(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => { window = undefined; });
  void window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return createWindow();
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    origin = await start();
    createWindow();
    checkForUpdates();
    // macOS keeps the app (and its API) alive with no window; the Dock icon opens a new one.
    app.on("activate", () => { if (!window) createWindow(); });
  }).catch((error: unknown) => {
    dialog.showErrorBox("Endpoint Quality", `The local API could not start (data in ${DATA_DIR}).\n\n${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // The database is written on close: wait for the API before letting the process go.
  let closing = false;
  app.on("before-quit", (event) => {
    if (!server || closing) return;
    closing = true;
    event.preventDefault();
    void server.close().catch(() => undefined).finally(() => { server = undefined; app.quit(); });
  });
}
