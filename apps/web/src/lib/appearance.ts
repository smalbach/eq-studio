/**
 * Where the appearance is saved: one JSON object with the Radix Themes settings. `index.html`
 * reads it before the first paint, so it must stay readable by that inline script too.
 */
export const APPEARANCE_KEY = "endpoint-quality:appearance";
/** Where the light/dark choice lived before the appearance settings; read once to carry it over. */
export const LEGACY_THEME_KEY = "endpoint-quality:theme";

/** Light, dark, or whatever the operating system says. */
export type ThemeChoice = "light" | "dark" | "system";
export const ACCENT_COLORS = ["gray", "gold", "bronze", "brown", "yellow", "amber", "orange", "tomato", "red", "ruby", "crimson", "pink", "plum", "purple", "violet", "iris", "indigo", "blue", "cyan", "teal", "jade", "green", "grass", "lime", "mint", "sky"] as const;
export const GRAY_COLORS = ["auto", "gray", "mauve", "slate", "sage", "olive", "sand"] as const;
export const RADII = ["none", "small", "medium", "large", "full"] as const;
export const SCALINGS = ["90%", "95%", "100%", "105%", "110%"] as const;
export const PANEL_BACKGROUNDS = ["solid", "translucent"] as const;

/** Everything Radix Themes lets the user tune, saved together in localStorage. */
export type Appearance = {
  theme: ThemeChoice;
  accentColor: (typeof ACCENT_COLORS)[number];
  grayColor: (typeof GRAY_COLORS)[number];
  radius: (typeof RADII)[number];
  scaling: (typeof SCALINGS)[number];
  panelBackground: (typeof PANEL_BACKGROUNDS)[number];
};

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", accentColor: "jade", grayColor: "slate", radius: "medium", scaling: "100%", panelBackground: "solid" };

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => options.includes(value as T) ? value as T : fallback;

/** A saved value is trusted field by field: an unknown or missing one falls back to its default. */
export function parseAppearance(saved: string | null, legacyTheme: string | null = null): Appearance {
  let raw: Record<string, unknown> = {};
  try { raw = saved ? JSON.parse(saved) as Record<string, unknown> : {}; } catch { /* corrupt: defaults */ }
  if (!raw || typeof raw !== "object") raw = {};
  return {
    theme: oneOf(["light", "dark", "system"] as const, raw.theme ?? legacyTheme, DEFAULT_APPEARANCE.theme),
    accentColor: oneOf(ACCENT_COLORS, raw.accentColor, DEFAULT_APPEARANCE.accentColor),
    grayColor: oneOf(GRAY_COLORS, raw.grayColor, DEFAULT_APPEARANCE.grayColor),
    radius: oneOf(RADII, raw.radius, DEFAULT_APPEARANCE.radius),
    scaling: oneOf(SCALINGS, raw.scaling, DEFAULT_APPEARANCE.scaling),
    panelBackground: oneOf(PANEL_BACKGROUNDS, raw.panelBackground, DEFAULT_APPEARANCE.panelBackground),
  };
}
