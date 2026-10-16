/**
 * Five-field cron (minute hour day-of-month month day-of-week), always in UTC, plus the presets
 * `@hourly`, `@daily` and `@weekly`. Lists, ranges and steps (`0,30`, `1-5`, `0-45/15`) are
 * supported; names (`MON`, `JAN`) are not — the UI offers presets for the common cases.
 *
 * UTC on purpose: the same schedule fires at the same instant whichever API process, laptop or
 * container evaluates it, and daylight saving never skips or repeats an occurrence.
 */
import { Invalid } from "../../../shared/errors.ts";

export const PRESETS: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 6 * * *", "@weekly": "0 6 * * 1" };

export type Cron = { minutes: Set<number>; hours: Set<number>; days: Set<number>; months: Set<number>; weekdays: Set<number>; anyDay: boolean; anyWeekday: boolean };

const FIELDS = [["minute", 0, 59], ["hour", 0, 23], ["day of month", 1, 31], ["month", 1, 12], ["day of week", 0, 7]] as const;

function field(text: string, [name, min, max]: (typeof FIELDS)[number]): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Invalid(`The cron ${name} "${text}" is not valid`);
    const step = match[4] ? Number(match[4]) : 1;
    const from = match[1] === "*" ? min : Number(match[2]);
    const to = match[1] === "*" ? max : match[3] !== undefined ? Number(match[3]) : match[4] ? max : from;
    if (step < 1 || from < min || to > max || from > to) throw new Invalid(`The cron ${name} "${text}" is out of range (${min}-${max})`);
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expression: string): Cron {
  const source = PRESETS[expression.trim()] ?? expression.trim();
  const parts = source.split(/\s+/);
  if (parts.length !== 5) throw new Invalid(`A cron expression has five fields (minute hour day month weekday), or is @hourly, @daily or @weekly: "${expression}"`);
  const [minutes, hours, days, months, weekdays] = parts.map((part, index) => field(part, FIELDS[index]));
  // 7 is Sunday too, as in most crons.
  if (weekdays.delete(7)) weekdays.add(0);
  return { minutes, hours, days, months, weekdays, anyDay: parts[2] === "*", anyWeekday: parts[4] === "*" };
}

/** Classic cron: with both day fields restricted, either one matching is enough. */
function dayMatches(cron: Cron, date: Date) {
  const day = cron.days.has(date.getUTCDate());
  const weekday = cron.weekdays.has(date.getUTCDay());
  if (cron.anyDay && cron.anyWeekday) return true;
  if (cron.anyDay) return weekday;
  if (cron.anyWeekday) return day;
  return day || weekday;
}

/** The first occurrence strictly after `from`, to the minute. Skips whole months, days and hours
 * that cannot match, so even a yearly expression is found in a few hundred steps. */
export function nextOccurrence(expression: string | Cron, from: Date): Date {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  const date = new Date(from.getTime());
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(date.getUTCMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 24 * 3600_000;
  while (date.getTime() <= limit) {
    if (!cron.months.has(date.getUTCMonth() + 1)) { date.setUTCMonth(date.getUTCMonth() + 1, 1); date.setUTCHours(0, 0); continue; }
    if (!dayMatches(cron, date)) { date.setUTCDate(date.getUTCDate() + 1); date.setUTCHours(0, 0); continue; }
    if (!cron.hours.has(date.getUTCHours())) { date.setUTCHours(date.getUTCHours() + 1, 0); continue; }
    if (!cron.minutes.has(date.getUTCMinutes())) { date.setUTCMinutes(date.getUTCMinutes() + 1); continue; }
    return date;
  }
  throw new Invalid(`The cron expression "${typeof expression === "string" ? expression : "…"}" never fires`);
}
