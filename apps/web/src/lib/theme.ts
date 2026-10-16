import { useEffect, useSyncExternalStore } from "react";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, LEGACY_THEME_KEY, parseAppearance, type Appearance, type ThemeChoice } from "@/lib/appearance";

export * from "@/lib/appearance";

const CHANGE = "eq-appearance-change";

// useSyncExternalStore needs the same object while nothing changed.
let cache: { key: string; value: Appearance } | null = null;
function read(): Appearance {
  let saved: string | null = null;
  let legacy: string | null = null;
  try { saved = localStorage.getItem(APPEARANCE_KEY); legacy = localStorage.getItem(LEGACY_THEME_KEY); } catch { /* private window: defaults */ }
  const key = `${saved}|${legacy}`;
  if (cache?.key !== key) cache = { key, value: parseAppearance(saved, legacy) };
  return cache.value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(CHANGE, onChange); window.removeEventListener("storage", onChange); };
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");
export const isDark = (choice: ThemeChoice) => choice === "dark" || (choice === "system" && systemDark().matches);

/** <html data-theme> and its `dark`/`light` class: the page background and Radix's colour scales follow them. */
function apply(choice: ThemeChoice) {
  const dark = isDark(choice);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
}

/** The saved appearance, the resolved light/dark mode, and a setter that saves and applies a change. */
export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, read, () => DEFAULT_APPEARANCE);
  const resolved = useSyncExternalStore<"light" | "dark">(subscribeSystem, () => isDark(appearance.theme) ? "dark" : "light", () => "light");
  useEffect(() => { apply(appearance.theme); }, [appearance.theme, resolved]);
  const update = (patch: Partial<Appearance>) => {
    const next = { ...read(), ...patch };
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); localStorage.removeItem(LEGACY_THEME_KEY); } catch { /* storage blocked: nothing to save, nothing to apply later */ }
    apply(next.theme);
    window.dispatchEvent(new Event(CHANGE));
  };
  const reset = () => update(DEFAULT_APPEARANCE);
  return { appearance, resolved, update, reset };
}

function subscribeSystem(onChange: () => void) {
  const media = systemDark();
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
