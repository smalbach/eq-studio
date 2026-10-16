import { useEffect, useState } from "react";
import { Box, Button, Flex, Grid, IconButton, Popover, SegmentedControl, Separator, Text, Theme, Tooltip } from "@radix-ui/themes";
import { Monitor, Moon, Palette, RotateCcw, Sun } from "lucide-react";
import { ACCENT_COLORS, GRAY_COLORS, PANEL_BACKGROUNDS, RADII, SCALINGS, useAppearance, type Appearance, type ThemeChoice } from "@/lib/theme";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Apariencia", hint: "Se guarda en este navegador.", open: "Apariencia: tema, colores, radio y escala",
    theme: "Tema", light: "Claro", dark: "Oscuro", system: "Sistema",
    accent: "Color de acento", gray: "Gris", auto: "Automático (según el acento)", radius: "Radio", scaling: "Escala", panel: "Paneles", solid: "Sólidos", translucent: "Translúcidos",
    radiusName: { none: "Ninguno", small: "Pequeño", medium: "Mediano", large: "Grande", full: "Completo" } as Record<string, string>,
    reset: "Restablecer",
  },
  en: {
    title: "Appearance", hint: "Saved in this browser.", open: "Appearance: theme, colours, radius and scaling",
    theme: "Theme", light: "Light", dark: "Dark", system: "System",
    accent: "Accent colour", gray: "Gray", auto: "Automatic (matches the accent)", radius: "Radius", scaling: "Scaling", panel: "Panels", solid: "Solid", translucent: "Translucent",
    radiusName: { none: "None", small: "Small", medium: "Medium", large: "Large", full: "Full" } as Record<string, string>,
    reset: "Reset",
  },
});

const THEMES: { id: ThemeChoice; icon: typeof Sun }[] = [{ id: "light", icon: Sun }, { id: "dark", icon: Moon }, { id: "system", icon: Monitor }];

/**
 * The Radix theme root of the whole app, set from the saved appearance. Printing always uses the
 * light theme: paper is white whatever the screen shows.
 */
export function ThemeRoot({ children }: { children: React.ReactNode }) {
  const { appearance, resolved } = useAppearance();
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => { setPrinting(true); document.documentElement.classList.replace("dark", "light"); };
    const after = () => { setPrinting(false); if (resolved === "dark") document.documentElement.classList.replace("light", "dark"); };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, [resolved]);
  return <Theme appearance={printing ? "light" : resolved} accentColor={appearance.accentColor} grayColor={appearance.grayColor} radius={appearance.radius} scaling={appearance.scaling} panelBackground={appearance.panelBackground}>
    {children}
  </Theme>;
}

/** A labelled row of the settings. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Box><Text as="p" size="1" weight="medium" color="gray" mb="2">{label}</Text>{children}</Box>;
}

/** A round swatch of one Radix colour, pressed when it is the current one. */
function Swatch({ color, label, selected, onSelect }: { color: string; label: string; selected: boolean; onSelect: () => void }) {
  return <Tooltip content={label}>
    <button type="button" aria-label={label} aria-pressed={selected} onClick={onSelect}
      className="grid size-7 place-items-center rounded-full outline-none ring-offset-2 ring-offset-[var(--color-panel-solid)] focus-visible:ring-2 focus-visible:ring-[var(--focus-8)]"
      style={{ background: color === "auto" ? "conic-gradient(var(--jade-9), var(--blue-9), var(--crimson-9), var(--amber-9), var(--jade-9))" : `var(--${color}-9)`, boxShadow: selected ? "0 0 0 2px var(--color-panel-solid), 0 0 0 4px var(--gray-12)" : undefined }}/>
  </Tooltip>;
}

/**
 * Every Radix Themes setting, as in Radix's own theme panel: light/dark, accent, gray, radius,
 * scaling and panel background. Each change applies at once and is saved in localStorage.
 */
export function AppearanceSettings() {
  const t = useMessages(MESSAGES);
  const { appearance, update, reset } = useAppearance();
  const set = <K extends keyof Appearance>(key: K) => (value: string) => update({ [key]: value } as Partial<Appearance>);
  const name = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return <Flex direction="column" gap="4">
    <Field label={t.theme}>
      <SegmentedControl.Root size="1" value={appearance.theme} onValueChange={set("theme")}>
        {THEMES.map(({ id, icon: Icon }) => <SegmentedControl.Item key={id} value={id}><Flex align="center" gap="1"><Icon className="size-3.5"/>{t[id]}</Flex></SegmentedControl.Item>)}
      </SegmentedControl.Root>
    </Field>
    <Field label={t.accent}>
      <Grid columns="9" gap="2" width="fit-content">{ACCENT_COLORS.map((color) => <Swatch key={color} color={color} label={name(color)} selected={appearance.accentColor === color} onSelect={() => update({ accentColor: color })}/>)}</Grid>
    </Field>
    <Field label={t.gray}>
      <Flex gap="2" wrap="wrap">{GRAY_COLORS.map((color) => <Swatch key={color} color={color} label={color === "auto" ? t.auto : name(color)} selected={appearance.grayColor === color} onSelect={() => update({ grayColor: color })}/>)}</Flex>
    </Field>
    <Field label={t.radius}>
      <SegmentedControl.Root size="1" value={appearance.radius} onValueChange={set("radius")}>
        {RADII.map((radius) => <SegmentedControl.Item key={radius} value={radius}>{t.radiusName[radius]}</SegmentedControl.Item>)}
      </SegmentedControl.Root>
    </Field>
    <Field label={t.scaling}>
      <SegmentedControl.Root size="1" value={appearance.scaling} onValueChange={set("scaling")}>
        {SCALINGS.map((scaling) => <SegmentedControl.Item key={scaling} value={scaling}>{scaling}</SegmentedControl.Item>)}
      </SegmentedControl.Root>
    </Field>
    <Field label={t.panel}>
      <SegmentedControl.Root size="1" value={appearance.panelBackground} onValueChange={set("panelBackground")}>
        {PANEL_BACKGROUNDS.map((panel) => <SegmentedControl.Item key={panel} value={panel}>{t[panel]}</SegmentedControl.Item>)}
      </SegmentedControl.Root>
    </Field>
    <Separator size="4"/>
    <Flex align="center" justify="between" gap="3">
      <Text size="1" color="gray">{t.hint}</Text>
      <Button size="1" variant="soft" color="gray" onClick={reset}><RotateCcw className="size-3.5"/>{t.reset}</Button>
    </Flex>
  </Flex>;
}

/** The header's palette button: the same settings in a popover, a click away from any screen. */
export function AppearanceMenu() {
  const t = useMessages(MESSAGES);
  return <Popover.Root>
    <Tooltip content={t.open}><Popover.Trigger><IconButton variant="surface" color="gray" aria-label={t.open}><Palette className="size-4"/></IconButton></Popover.Trigger></Tooltip>
    <Popover.Content width="420px" maxWidth="calc(100vw - 2rem)" align="end">
      <Text as="p" size="2" weight="bold" mb="3">{t.title}</Text>
      <AppearanceSettings/>
    </Popover.Content>
  </Popover.Root>;
}
