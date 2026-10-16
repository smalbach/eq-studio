import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_LOCALE, LOCALE_KEY, intlLocale, normalizeLocale, tr } from "@/lib/i18n-core.mjs";

/**
 * Spanish or English, for every screen.
 *
 * Texts live next to the component that shows them, in a catalog with one object per language:
 *
 *     const MESSAGES = defineMessages({
 *       es: { title: "Pruebas", count: (n: number) => `${n} pruebas` },
 *       en: { title: "Tests", count: (n: number) => `${n} tests` },
 *     });
 *     const t = useMessages(MESSAGES);  // t.title, t.count(3)
 *
 * `defineMessages` makes TypeScript reject an English catalog that misses a key or changes a
 * function's parameters, so the two languages cannot drift apart.
 */
export type Locale = "es" | "en";
type Messages = Record<string, unknown>;

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: DEFAULT_LOCALE as Locale, setLocale: () => {} });

/** The language saved in this browser, or Spanish. */
export function initialLocale(): Locale {
  try { return normalizeLocale(localStorage.getItem(LOCALE_KEY)); } catch { return DEFAULT_LOCALE as Locale; }
}

/** Holds the language for the whole app. */
export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setState] = useState<Locale>(initial);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = (next: Locale) => {
    try { localStorage.setItem(LOCALE_KEY, next); } catch { /* a private window simply forgets it */ }
    setState(next);
  };
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext).locale;
export const useSetLocale = () => useContext(LocaleContext).setLocale;

/** The catalog, checked: English must have every Spanish key with the same type. */
export function defineMessages<T extends Messages>(catalog: { es: T; en: NoInfer<{ [K in keyof T]: T[K] }> }) {
  return catalog as { es: T; en: T };
}

/** The texts of the active language. */
export function useMessages<T extends Messages>(catalog: { es: T; en: T }): T {
  return catalog[useLocale()];
}

/** For one-off sentences built from data: `const t = useTr(); t("Hola", "Hello")`. */
export function useTr() {
  const locale = useLocale();
  return <V,>(es: V, en: V) => tr(locale, es, en);
}

/** The BCP 47 tag of the active language, for `toLocaleString`. */
export const useIntlLocale = () => intlLocale(useLocale());
