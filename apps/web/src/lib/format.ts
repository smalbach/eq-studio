/** Small formatting and browser helpers shared by every view. Dates and ages take the locale. */
import { intlLocale, tr } from "@/lib/i18n-core.mjs";
import type { Locale } from "@/lib/i18n";

export const isLoopback = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url);

/** Read only inside event handlers; kept outside components so render stays pure. */
export const wallClock = () => Date.now();

export const formatDate = (at: number, locale: Locale = "es") => new Date(at).toLocaleString(intlLocale(locale));

/** A number with the thousands separator of the language. */
export const formatNumber = (value: number, locale: Locale = "es") => value.toLocaleString(intlLocale(locale));

export const seconds = (ms: number) => ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${(ms / 1000).toFixed(1)} s`;

export const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)} %`;

/** "hace 5 min" / "5 min ago" style age of a timestamp, relative to `now`. */
export function ago(at: number, now: number, locale: Locale = "es") {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  const unit = (value: number, short: string) => tr(locale, `hace ${value} ${short}`, `${value} ${short} ago`);
  if (minutes < 1) return tr(locale, "hace un momento", "just now");
  if (minutes < 60) return unit(minutes, "min");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return unit(hours, "h");
  return unit(Math.round(hours / 24), "d");
}

export const fileStamp = (at: number) => new Date(at).toISOString().replace(/[:.]/g, "-").slice(0, 19);

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
