import { SegmentedControl } from "@radix-ui/themes";
import { defineMessages, useLocale, useMessages, useSetLocale, type Locale } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { group: "Idioma", es: "Español", en: "Inglés" },
  en: { group: "Language", es: "Spanish", en: "English" },
});

/** ES / EN: a segmented control, the selected segment is the current language. */
export function LanguageToggle() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useMessages(MESSAGES);
  return <SegmentedControl.Root size="1" value={locale} onValueChange={(value) => setLocale(value as Locale)} aria-label={t.group} className="shrink-0">
    {(["es", "en"] as Locale[]).map((id) => <SegmentedControl.Item key={id} value={id} lang={id} title={t[id]} aria-label={t[id]} className="uppercase">{id}</SegmentedControl.Item>)}
  </SegmentedControl.Root>;
}
