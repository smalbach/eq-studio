/**
 * Chart colours as CSS variables, so every chart follows the theme. The values live in
 * `app/globals.css` (one set per theme), validated for colour-blind separation on each surface.
 * Fixed by role and in this order — a series keeps its colour whatever else is on the chart.
 */
export const CHART = {
  blue: "var(--chart-blue)",
  violet: "var(--chart-violet)",
  amber: "var(--chart-amber)",
  rose: "var(--chart-rose)",
  green: "var(--chart-green)",
  muted: "var(--chart-muted)",
  grid: "var(--chart-grid)",
  reference: "var(--chart-reference)",
  surface: "var(--chart-surface)",
} as const;
