import { boot } from "./boot";
import { ipc } from "./ipc";
import { settings } from "./settings.svelte";
import { BUILTIN_THEMES, parseThemeFile, type ThemeColors, type ThemeDef } from "./themes";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export const themeState = $state({
  systemDark: media.matches,
  custom: [] as ThemeDef[],
  /** Theme id shown temporarily while browsing the theme picker. */
  preview: null as string | null,
});

media.addEventListener("change", (e) => (themeState.systemDark = e.matches));

export function allThemes(): ThemeDef[] {
  return [...BUILTIN_THEMES, ...themeState.custom];
}

export function findTheme(id: string): ThemeDef | undefined {
  return themeState.custom.find((t) => t.id === id) ?? BUILTIN_THEMES.find((t) => t.id === id);
}

export function isDarkMode(): boolean {
  return settings.themeMode === "dark" || (settings.themeMode === "system" && themeState.systemDark);
}

export function currentTheme(): ThemeDef {
  if (themeState.preview) {
    const p = findTheme(themeState.preview);
    if (p) return p;
  }
  const dark = isDarkMode();
  const id = dark ? settings.darkTheme : settings.lightTheme;
  const found = findTheme(id);
  if (found && found.dark === dark) return found;
  return findTheme(dark ? "margin-dark" : "margin-light")!;
}

export function loadCustomThemes(files: { file: string; text: string }[]): void {
  const list: ThemeDef[] = [];
  for (const f of files) {
    const t = parseThemeFile(f.text, f.file);
    if (t && !list.some((x) => x.id === t.id)) list.push(t);
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  themeState.custom = list;
}

export async function reloadCustomThemes(): Promise<void> {
  loadCustomThemes(await ipc.listThemes());
}

const VAR_NAMES: Record<keyof ThemeColors, string> = {
  bg: "--bg", surface: "--surface", surface2: "--surface-2", border: "--border", fg: "--fg",
  muted: "--muted", faint: "--faint", accent: "--accent", accentFg: "--accent-fg", selection: "--selection",
  cursor: "--cursor", lineHighlight: "--line-hl", match: "--match", matchActive: "--match-active",
  gutter: "--gutter", danger: "--danger", keyword: "--tk-keyword", string: "--tk-string",
  number: "--tk-number", constant: "--tk-constant", comment: "--tk-comment", function: "--tk-function",
  variable: "--tk-variable", property: "--tk-property", type: "--tk-type", operator: "--tk-operator",
  punctuation: "--tk-punctuation", tag: "--tk-tag", attribute: "--tk-attribute", heading: "--tk-heading",
  link: "--tk-link", regexp: "--tk-regexp", meta: "--tk-meta", inserted: "--tk-inserted", deleted: "--tk-deleted",
};

let lastBg = "";
let bgTimer: ReturnType<typeof setTimeout> | undefined;

export function applyTheme(theme: ThemeDef): void {
  const root = document.documentElement;
  for (const [key, name] of Object.entries(VAR_NAMES)) {
    root.style.setProperty(name, theme.colors[key as keyof ThemeColors]);
  }
  root.style.colorScheme = theme.dark ? "dark" : "light";
  root.dataset.dark = String(theme.dark);
  if (theme.colors.bg !== lastBg) {
    lastBg = theme.colors.bg;
    clearTimeout(bgTimer);
    // The native window background is what shows before the page paints on next launch.
    bgTimer = setTimeout(() => ipc.setWindowBg(lastBg).catch(() => {}), 300);
  }
}

/** Applies the theme immediately at startup and keeps it in sync afterwards. */
export function initTheme(): void {
  loadCustomThemes(boot.customThemes ?? []);
  applyTheme(currentTheme());
  $effect.root(() => {
    $effect(() => applyTheme(currentTheme()));
  });
}
