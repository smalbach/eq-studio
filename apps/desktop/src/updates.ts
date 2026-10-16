/**
 * Update checks against the GitHub releases (`publish` in `electron-builder.yml`).
 *
 * One check per start, and only in a packaged app: `pnpm desktop` never asks. Nothing interrupts
 * the work in progress — a new version is announced with a system notification, never a dialog.
 *
 * - Windows and Linux (AppImage): the update downloads in the background and installs on quit.
 * - macOS: Squirrel.Mac only installs updates signed with a Developer ID, and the build is signed
 *   ad hoc. Downloading would always fail, so the notification opens the release page instead.
 *
 * `EQ_NO_UPDATE_CHECK=1` turns the check off.
 */
import { app, Notification, shell } from "electron";
import { autoUpdater } from "electron-updater";

const RELEASES = "https://github.com/smalbach/eq-studio/releases/latest";

function notify(body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: "Endpoint Quality", body });
  if (onClick) notification.on("click", onClick);
  notification.show();
}

export function checkForUpdates() {
  if (!app.isPackaged || process.env.EQ_NO_UPDATE_CHECK === "1") return;
  const canInstall = process.platform !== "darwin";
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  // A failed check (offline, rate limited, no release yet) is not worth telling anyone about.
  autoUpdater.logger = null;
  autoUpdater.on("error", () => undefined);

  if (canInstall) {
    autoUpdater.on("update-downloaded", ({ version }) => {
      notify(`Version ${version} is ready. It installs when you quit the app.`);
    });
  } else {
    autoUpdater.on("update-available", ({ version }) => {
      notify(`Version ${version} is available. Click to download it.`, () => void shell.openExternal(RELEASES));
    });
  }
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
