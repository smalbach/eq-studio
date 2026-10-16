import { useEffect, useRef } from "react";
import { loadSettings, saveSettings } from "@/lib/settings.mjs";

/** `dashboard:<project id>`, `load`: see `settingsKey` in `lib/settings.mjs`. */
type Kind = string;
type Remember = { credentials: boolean; secrets: boolean };

/**
 * Restores a component's saved settings once after mount and saves them on every change.
 *
 * Restored after mount and not in the `useState` initializers: the page is server-rendered,
 * and a first client render that already differs from the server's HTML is a hydration error.
 *
 * The first save after the restore is skipped on purpose. Both effects run in the same commit,
 * before the restored state has re-rendered, so that save would hold the **defaults** and
 * overwrite what was just read. The next render carries the restored values and saves them.
 */
export function usePersistedSettings(kind: Kind, snapshot: Record<string, unknown>, apply: (saved: Record<string, unknown>) => void, remember: Remember) {
  const applyRef = useRef(apply);
  const skipNextSave = useRef(true);
  useEffect(() => { applyRef.current = apply; });
  useEffect(() => {
    // Re-armed on every restore, so StrictMode's second mount skips its stale save too.
    skipNextSave.current = true;
    const saved = loadSettings(kind);
    if (saved) applyRef.current(saved);
  }, [kind]);
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    saveSettings(kind, JSON.parse(serialized), remember);
  }, [kind, serialized, remember.credentials, remember.secrets]); // eslint-disable-line react-hooks/exhaustive-deps -- `remember` is read by its two fields
}
