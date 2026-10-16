/** Axis helpers shared by the SVG charts. */

/** A round axis top just above `value`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** Gridlines from zero to the top on round values: quarters of 1 or 2 (×10ⁿ), fifths of 2.5 or 5. */
export function quarterTicks(top: number) {
  const lead = top / 10 ** Math.floor(Math.log10(top || 1));
  const parts = Math.abs(lead - 2.5) < 1e-9 || Math.abs(lead - 5) < 1e-9 ? 5 : 4;
  return Array.from({ length: parts + 1 }, (_, index) => (index / parts) * top);
}

/** A tick label: decimals only when the axis is small. */
export const tickLabel = (tick: number, top: number) => top < 5 ? String(Number(tick.toFixed(2))) : String(Math.round(tick));

/** A value with its unit, one decimal at most. */
export const withUnit = (value: number | null | undefined, unit: string) => value == null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}${unit ? ` ${unit}` : ""}`;

/**
 * A log axis for ratios (×1 = baseline): from `LOG_FLOOR` to the next 1-2-5 step above the data.
 * A ratio that climbs from ×1.2 to ×80 is unreadable on a linear axis — the onset, which is the
 * point of the chart, is flattened into the floor.
 */
export const LOG_FLOOR = 0.5;
const LOG_STEPS = [1, 2, 5];
export function logTicks(value: number) {
  const ticks = [LOG_FLOOR];
  for (let power = 0; ticks.at(-1)! < Math.max(value, 2); power += 1) for (const step of LOG_STEPS) { ticks.push(step * 10 ** power); if (ticks.at(-1)! >= Math.max(value, 2)) break; }
  return ticks;
}
/** Position of `value` on a log axis between `LOG_FLOOR` and `top`, as 0..1. */
export const logRatio = (value: number, top: number) => Math.log(Math.max(value, LOG_FLOOR) / LOG_FLOOR) / Math.log(top / LOG_FLOOR);
