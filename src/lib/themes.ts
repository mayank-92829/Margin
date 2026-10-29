import { parseJsonc } from "./jsonc";

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  accentFg: string;
  selection: string;
  cursor: string;
  lineHighlight: string;
  match: string;
  matchActive: string;
  gutter: string;
  danger: string;
  keyword: string;
  string: string;
  number: string;
  constant: string;
  comment: string;
  function: string;
  variable: string;
  property: string;
  type: string;
  operator: string;
  punctuation: string;
  tag: string;
  attribute: string;
  heading: string;
  link: string;
  regexp: string;
  meta: string;
  inserted: string;
  deleted: string;
}

export const COLOR_KEYS = [
  "bg", "surface", "surface2", "border", "fg", "muted", "faint", "accent", "accentFg", "selection",
  "cursor", "lineHighlight", "match", "matchActive", "gutter", "danger", "keyword", "string", "number",
  "constant", "comment", "function", "variable", "property", "type", "operator", "punctuation", "tag",
  "attribute", "heading", "link", "regexp", "meta", "inserted", "deleted",
] as const satisfies readonly (keyof ThemeColors)[];

export interface ThemeDef {
  id: string;
  name: string;
  dark: boolean;
  colors: ThemeColors;
  file?: string;
}

/** The handful of colors a theme must define; everything else is derived. */
export interface ThemeBase extends Partial<ThemeColors> {
  bg: string;
  fg: string;
  accent: string;
  kw: string;
  str: string;
  num: string;
  cmt: string;
  fn: string;
  type: string;
  tag: string;
}

// ---- color math ----

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  const v = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(v)) return [128, 128, 128];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function hex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix `a` toward `b` by amount t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function alpha(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
}

/** Solid 6-digit hex (drops alpha) — needed for color math. */
function solid(c: string): string {
  return hex(...rgb(c));
}

export function deriveColors(b: ThemeBase, dark: boolean): ThemeColors {
  const bg = solid(b.bg);
  const fg = solid(b.fg);
  const veryDark = luminance(bg) < 0.012;
  const surface = b.surface ?? (veryDark ? mix(bg, fg, 0.055) : dark ? mix(bg, "#000000", 0.24) : mix(bg, "#000000", 0.045));
  return {
    bg,
    fg,
    surface,
    surface2: b.surface2 ?? mix(surface, fg, dark ? 0.08 : 0.07),
    border: b.border ?? mix(bg, fg, dark ? 0.13 : 0.12),
    muted: b.muted ?? mix(fg, bg, 0.32),
    faint: b.faint ?? mix(fg, bg, 0.55),
    accent: b.accent,
    accentFg: b.accentFg ?? (luminance(solid(b.accent)) > 0.4 ? "#111111" : "#ffffff"),
    selection: b.selection ?? alpha(b.accent, dark ? 0.3 : 0.22),
    cursor: b.cursor ?? b.accent,
    lineHighlight: b.lineHighlight ?? mix(bg, fg, dark ? 0.045 : 0.035),
    match: b.match ?? alpha(b.num, dark ? 0.25 : 0.22),
    matchActive: b.matchActive ?? alpha(b.num, dark ? 0.55 : 0.45),
    gutter: b.gutter ?? mix(fg, bg, 0.6),
    danger: b.danger ?? (dark ? "#f47067" : "#cf222e"),
    keyword: b.keyword ?? b.kw,
    string: b.string ?? b.str,
    number: b.number ?? b.num,
    constant: b.constant ?? b.num,
    comment: b.comment ?? b.cmt,
    function: b.function ?? b.fn,
    variable: b.variable ?? fg,
    property: b.property ?? mix(fg, b.fn, 0.3),
    type: b.type,
    operator: b.operator ?? mix(fg, b.kw, 0.45),
    punctuation: b.punctuation ?? mix(fg, bg, 0.28),
    tag: b.tag,
    attribute: b.attribute ?? b.num,
    heading: b.heading ?? b.kw,
    link: b.link ?? b.accent,
    regexp: b.regexp ?? b.str,
    meta: b.meta ?? mix(fg, bg, 0.4),
    inserted: b.inserted ?? b.str,
    deleted: b.deleted ?? b.tag,
  };
}

function t(id: string, name: string, dark: boolean, base: ThemeBase): ThemeDef {
  return { id, name, dark, colors: deriveColors(base, dark) };
}

export const BUILTIN_THEMES: ThemeDef[] = [
  // ---- dark ----
  t("margin-dark", "Margin Dark", true, { bg: "#1b1b1f", fg: "#dcdce1", accent: "#8ab4ff", kw: "#c3a6ff", str: "#a8d8a0", num: "#f5c08a", cmt: "#6e6e78", fn: "#86b8ff", type: "#7fd8cc", tag: "#ff9d9d" }),
  t("midnight", "Midnight", true, { bg: "#000000", fg: "#d6d6d6", accent: "#7c9cff", kw: "#c586c0", str: "#ce9178", num: "#b5cea8", cmt: "#6a9955", fn: "#dcdcaa", type: "#4ec9b0", tag: "#569cd6" }),
  t("charcoal", "Charcoal", true, { bg: "#1f1f1f", fg: "#cccccc", accent: "#3b8eea", kw: "#569cd6", str: "#ce9178", num: "#b5cea8", cmt: "#6a9955", fn: "#dcdcaa", type: "#4ec9b0", tag: "#569cd6", property: "#9cdcfe", variable: "#9cdcfe", attribute: "#9cdcfe" }),
  t("one-dark", "One Dark", true, { bg: "#282c34", fg: "#abb2bf", accent: "#61afef", kw: "#c678dd", str: "#98c379", num: "#d19a66", cmt: "#5c6370", fn: "#61afef", type: "#e5c07b", tag: "#e06c75", variable: "#e06c75", property: "#e06c75" }),
  t("dracula", "Dracula", true, { bg: "#282a36", fg: "#f8f8f2", accent: "#bd93f9", kw: "#ff79c6", str: "#f1fa8c", num: "#bd93f9", cmt: "#6272a4", fn: "#50fa7b", type: "#8be9fd", tag: "#ff79c6", attribute: "#50fa7b" }),
  t("nord", "Nord", true, { bg: "#2e3440", fg: "#d8dee9", accent: "#88c0d0", kw: "#81a1c1", str: "#a3be8c", num: "#b48ead", cmt: "#616e88", fn: "#88c0d0", type: "#8fbcbb", tag: "#81a1c1", attribute: "#8fbcbb" }),
  t("tokyo-night", "Tokyo Night", true, { bg: "#1a1b26", fg: "#c0caf5", accent: "#7aa2f7", kw: "#bb9af7", str: "#9ece6a", num: "#ff9e64", cmt: "#565f89", fn: "#7aa2f7", type: "#2ac3de", tag: "#f7768e", property: "#73daca" }),
  t("tokyo-storm", "Tokyo Night Storm", true, { bg: "#24283b", fg: "#c0caf5", accent: "#7aa2f7", kw: "#bb9af7", str: "#9ece6a", num: "#ff9e64", cmt: "#565f89", fn: "#7aa2f7", type: "#2ac3de", tag: "#f7768e", property: "#73daca" }),
  t("catppuccin-mocha", "Catppuccin Mocha", true, { bg: "#1e1e2e", fg: "#cdd6f4", accent: "#cba6f7", kw: "#cba6f7", str: "#a6e3a1", num: "#fab387", cmt: "#6c7086", fn: "#89b4fa", type: "#f9e2af", tag: "#f38ba8", property: "#b4befe" }),
  t("catppuccin-macchiato", "Catppuccin Macchiato", true, { bg: "#24273a", fg: "#cad3f5", accent: "#c6a0f6", kw: "#c6a0f6", str: "#a6da95", num: "#f5a97f", cmt: "#6e738d", fn: "#8aadf4", type: "#eed49f", tag: "#ed8796", property: "#b7bdf8" }),
  t("catppuccin-frappe", "Catppuccin Frappé", true, { bg: "#303446", fg: "#c6d0f5", accent: "#ca9ee6", kw: "#ca9ee6", str: "#a6d189", num: "#ef9f76", cmt: "#737994", fn: "#8caaee", type: "#e5c890", tag: "#e78284", property: "#babbf1" }),
  t("gruvbox-dark", "Gruvbox Dark", true, { bg: "#282828", fg: "#ebdbb2", accent: "#fabd2f", kw: "#fb4934", str: "#b8bb26", num: "#d3869b", cmt: "#928374", fn: "#8ec07c", type: "#fabd2f", tag: "#83a598", attribute: "#fe8019" }),
  t("solarized-dark", "Solarized Dark", true, { bg: "#002b36", fg: "#93a1a1", accent: "#268bd2", kw: "#859900", str: "#2aa198", num: "#d33682", cmt: "#586e75", fn: "#268bd2", type: "#b58900", tag: "#cb4b16" }),
  t("rose-pine", "Rosé Pine", true, { bg: "#191724", fg: "#e0def4", accent: "#c4a7e7", kw: "#31748f", str: "#f6c177", num: "#c4a7e7", cmt: "#6e6a86", fn: "#ebbcba", type: "#9ccfd8", tag: "#eb6f92", keyword: "#5fa3bd" }),
  t("rose-pine-moon", "Rosé Pine Moon", true, { bg: "#232136", fg: "#e0def4", accent: "#c4a7e7", kw: "#3e8fb0", str: "#f6c177", num: "#c4a7e7", cmt: "#6e6a86", fn: "#ea9a97", type: "#9ccfd8", tag: "#eb6f92", keyword: "#5fa8c8" }),
  t("github-dark", "GitHub Dark", true, { bg: "#0d1117", fg: "#e6edf3", accent: "#2f81f7", kw: "#ff7b72", str: "#a5d6ff", num: "#79c0ff", cmt: "#8b949e", fn: "#d2a8ff", type: "#ffa657", tag: "#7ee787", surface: "#010409", attribute: "#79c0ff" }),
  t("github-dimmed", "GitHub Dimmed", true, { bg: "#22272e", fg: "#adbac7", accent: "#539bf5", kw: "#f47067", str: "#96d0ff", num: "#6cb6ff", cmt: "#768390", fn: "#dcbdfb", type: "#f69d50", tag: "#8ddb8c", surface: "#1c2128" }),
  t("monokai", "Monokai", true, { bg: "#272822", fg: "#f8f8f2", accent: "#a6e22e", kw: "#f92672", str: "#e6db74", num: "#ae81ff", cmt: "#75715e", fn: "#a6e22e", type: "#66d9ef", tag: "#f92672", attribute: "#a6e22e" }),
  t("ayu-mirage", "Ayu Mirage", true, { bg: "#1f2430", fg: "#cccac2", accent: "#ffcc66", kw: "#ffad66", str: "#d5ff80", num: "#dfbfff", cmt: "#6e7c8f", fn: "#ffd173", type: "#73d0ff", tag: "#5ccfe6" }),
  t("ayu-dark", "Ayu Dark", true, { bg: "#0b0e14", fg: "#bfbdb6", accent: "#e6b450", kw: "#ff8f40", str: "#aad94c", num: "#d2a6ff", cmt: "#5c6773", fn: "#ffb454", type: "#59c2ff", tag: "#39bae6" }),
  t("everforest-dark", "Everforest Dark", true, { bg: "#2d353b", fg: "#d3c6aa", accent: "#a7c080", kw: "#e67e80", str: "#a7c080", num: "#d699b6", cmt: "#859289", fn: "#83c092", type: "#dbbc7f", tag: "#e69875" }),
  t("kanagawa", "Kanagawa", true, { bg: "#1f1f28", fg: "#dcd7ba", accent: "#7e9cd8", kw: "#957fb8", str: "#98bb6c", num: "#d27e99", cmt: "#727169", fn: "#7e9cd8", type: "#7aa89f", tag: "#e46876", variable: "#dcd7ba", property: "#e6c384" }),
  t("night-owl", "Night Owl", true, { bg: "#011627", fg: "#d6deeb", accent: "#82aaff", kw: "#c792ea", str: "#ecc48d", num: "#f78c6c", cmt: "#637777", fn: "#82aaff", type: "#ffcb8b", tag: "#7fdbca", property: "#addb67" }),
  t("poimandres", "Poimandres", true, { bg: "#1b1e28", fg: "#a6accd", accent: "#5de4c7", kw: "#91b4d5", str: "#5de4c7", num: "#5fb3a1", cmt: "#767c9d", fn: "#add7ff", type: "#fffac2", tag: "#d0679d" }),
  t("horizon", "Horizon", true, { bg: "#1c1e26", fg: "#d5d8da", accent: "#e95678", kw: "#b877db", str: "#fab795", num: "#f09483", cmt: "#6c6f93", fn: "#25b0bc", type: "#fac29a", tag: "#e95678" }),
  t("contrast-dark", "High Contrast Dark", true, { bg: "#000000", fg: "#ffffff", accent: "#ffd700", kw: "#ff7ad9", str: "#7dff7a", num: "#7ae7ff", cmt: "#b0b0b0", fn: "#ffd700", type: "#7ae7ff", tag: "#ff9b7a", border: "#6b6b6b", selection: "rgba(255, 215, 0, 0.35)" }),

  // ---- light ----
  t("margin-light", "Margin Light", false, { bg: "#fbfbfa", fg: "#2a2a2e", accent: "#3a6fd8", kw: "#7a3fd1", str: "#2f7d32", num: "#b25b00", cmt: "#9a9aa3", fn: "#2f5fc4", type: "#0f7c80", tag: "#c0392b" }),
  t("paper", "Paper", false, { bg: "#f6f1e7", fg: "#3b352c", accent: "#a0642c", kw: "#8b4a9c", str: "#5f7d2e", num: "#b5651d", cmt: "#a39a8a", fn: "#2f6f8f", type: "#8a6d1f", tag: "#b2433a", surface: "#ece5d6" }),
  t("snow", "Snow", false, { bg: "#ffffff", fg: "#1f2328", accent: "#2563eb", kw: "#9333ea", str: "#15803d", num: "#c2410c", cmt: "#94a3b8", fn: "#1d4ed8", type: "#0e7490", tag: "#be123c" }),
  t("github-light", "GitHub Light", false, { bg: "#ffffff", fg: "#1f2328", accent: "#0969da", kw: "#cf222e", str: "#0a3069", num: "#0550ae", cmt: "#6e7781", fn: "#8250df", type: "#953800", tag: "#116329", surface: "#f6f8fa" }),
  t("solarized-light", "Solarized Light", false, { bg: "#fdf6e3", fg: "#586e75", accent: "#268bd2", kw: "#859900", str: "#2aa198", num: "#d33682", cmt: "#93a1a1", fn: "#268bd2", type: "#b58900", tag: "#cb4b16", surface: "#eee8d5" }),
  t("catppuccin-latte", "Catppuccin Latte", false, { bg: "#eff1f5", fg: "#4c4f69", accent: "#8839ef", kw: "#8839ef", str: "#40a02b", num: "#fe640b", cmt: "#9ca0b0", fn: "#1e66f5", type: "#df8e1d", tag: "#d20f39", surface: "#e6e9ef" }),
  t("gruvbox-light", "Gruvbox Light", false, { bg: "#fbf1c7", fg: "#3c3836", accent: "#b57614", kw: "#9d0006", str: "#79740e", num: "#8f3f71", cmt: "#928374", fn: "#427b58", type: "#b57614", tag: "#076678", surface: "#f2e5bc" }),
  t("rose-pine-dawn", "Rosé Pine Dawn", false, { bg: "#faf4ed", fg: "#575279", accent: "#907aa9", kw: "#286983", str: "#ea9d34", num: "#907aa9", cmt: "#9893a5", fn: "#d7827e", type: "#56949f", tag: "#b4637a", surface: "#f2e9e1" }),
  t("ayu-light", "Ayu Light", false, { bg: "#fcfcfc", fg: "#5c6166", accent: "#fa8d3e", kw: "#fa8d3e", str: "#86b300", num: "#a37acc", cmt: "#adaeb1", fn: "#f2ae49", type: "#399ee6", tag: "#55b4d4", function: "#eba400" }),
  t("everforest-light", "Everforest Light", false, { bg: "#fdf6e3", fg: "#5c6a72", accent: "#8da101", kw: "#f85552", str: "#8da101", num: "#df69ba", cmt: "#939f91", fn: "#35a77c", type: "#dfa000", tag: "#f57d26", surface: "#f4f0d9" }),
  t("one-light", "One Light", false, { bg: "#fafafa", fg: "#383a42", accent: "#4078f2", kw: "#a626a4", str: "#50a14f", num: "#986801", cmt: "#a0a1a7", fn: "#4078f2", type: "#c18401", tag: "#e45649", variable: "#e45649", property: "#e45649" }),
  t("tokyo-day", "Tokyo Night Day", false, { bg: "#e1e2e7", fg: "#3760bf", accent: "#2e7de9", kw: "#9854f1", str: "#587539", num: "#b15c00", cmt: "#848cb5", fn: "#2e7de9", type: "#007197", tag: "#f52a65" }),
  t("nord-light", "Nord Light", false, { bg: "#eceff4", fg: "#2e3440", accent: "#5e81ac", kw: "#5e81ac", str: "#5b8a3c", num: "#8f5ea8", cmt: "#8a94a6", fn: "#3b7a8c", type: "#3d8b88", tag: "#5e81ac" }),
  t("quiet-light", "Quiet Light", false, { bg: "#f5f5f5", fg: "#333333", accent: "#4b69c6", kw: "#4b69c6", str: "#448c27", num: "#9c5d27", cmt: "#aaaaaa", fn: "#aa3731", type: "#7a3e9d", tag: "#4b69c6" }),
  t("kanagawa-lotus", "Kanagawa Lotus", false, { bg: "#f2ecbc", fg: "#545464", accent: "#4d699b", kw: "#624c83", str: "#6f894e", num: "#b35b79", cmt: "#8a8980", fn: "#4d699b", type: "#597b75", tag: "#c84053", surface: "#e5ddb0" }),
  t("contrast-light", "High Contrast Light", false, { bg: "#ffffff", fg: "#000000", accent: "#0f4fd1", kw: "#7b00b8", str: "#006100", num: "#9b2b00", cmt: "#5c5c5c", fn: "#0033a0", type: "#00636b", tag: "#a8001c", border: "#8a8a8a", selection: "rgba(15, 79, 209, 0.28)" }),
];

// ---- custom theme files ----

/** Custom theme file format: { "name", "dark", "colors": { any ThemeColors key, or the base keys } }. */
export function parseThemeFile(text: string, file: string): ThemeDef | null {
  let obj: Record<string, unknown>;
  try {
    obj = parseJsonc(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  if ("tokenColors" in obj || (obj.colors && typeof obj.colors === "object" && "editor.background" in (obj.colors as object))) {
    obj = fromVSCode(obj, file) as unknown as Record<string, unknown>;
  }
  const colors = (obj.colors ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | undefined => (isHexColor(colors[k]) || (typeof colors[k] === "string" && /^rgba?\(/.test(colors[k] as string)) ? (colors[k] as string) : undefined);
  const bg = isHexColor(colors.bg) ? colors.bg : undefined;
  const fg = isHexColor(colors.fg) ? colors.fg : undefined;
  if (!bg || !fg) return null;
  const dark = typeof obj.dark === "boolean" ? obj.dark : luminance(bg) < 0.4;
  const fallback = dark ? BUILTIN_THEMES[0].colors : BUILTIN_THEMES.find((x) => x.id === "margin-light")!.colors;
  const base: ThemeBase = {
    bg,
    fg,
    accent: pick("accent") ?? fallback.accent,
    kw: pick("keyword") ?? pick("kw") ?? fallback.keyword,
    str: pick("string") ?? pick("str") ?? fallback.string,
    num: pick("number") ?? pick("num") ?? fallback.number,
    cmt: pick("comment") ?? pick("cmt") ?? fallback.comment,
    fn: pick("function") ?? pick("fn") ?? fallback.function,
    type: pick("type") ?? fallback.type,
    tag: pick("tag") ?? fallback.tag,
  };
  for (const k of COLOR_KEYS) {
    const v = pick(k);
    if (v) (base as unknown as Record<string, string>)[k] = v;
  }
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : file.replace(/^.*[\\/]/, "").replace(/\.json$/i, "");
  return { id: "custom:" + name.toLowerCase().replace(/\s+/g, "-"), name, dark, colors: deriveColors(base, dark), file };
}

type VSRule = { scope?: string | string[]; settings?: { foreground?: string; fontStyle?: string } };

/** Converts a VS Code color theme into Margin's theme format. */
export function fromVSCode(json: Record<string, unknown>, file: string): { name: string; dark: boolean; colors: Record<string, string> } {
  const c = (json.colors ?? {}) as Record<string, string>;
  const rules = (Array.isArray(json.tokenColors) ? json.tokenColors : []) as VSRule[];
  const lookup = (scopes: string[]): string | undefined => {
    for (const want of scopes) {
      let best: { len: number; color: string } | undefined;
      for (const r of rules) {
        const color = r.settings?.foreground;
        if (!isHexColor(color)) continue;
        const sels = (Array.isArray(r.scope) ? r.scope : (r.scope ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
        for (const sel of sels) {
          if (sel.includes(" ")) continue;
          if ((want === sel || want.startsWith(sel + ".")) && (!best || sel.length > best.len)) best = { len: sel.length, color };
        }
      }
      if (best) return best.color;
    }
    return undefined;
  };
  const bg = c["editor.background"] ?? (json.type === "light" ? "#ffffff" : "#1e1e1e");
  const fg = c["editor.foreground"] ?? c["foreground"] ?? (json.type === "light" ? "#333333" : "#d4d4d4");
  const out: Record<string, string | undefined> = {
    bg,
    fg,
    accent: c["focusBorder"] ?? c["button.background"] ?? c["textLink.foreground"],
    surface: c["titleBar.activeBackground"] ?? c["tab.inactiveBackground"] ?? c["editorGroupHeader.tabsBackground"] ?? c["sideBar.background"],
    gutter: c["editorLineNumber.foreground"],
    selection: c["editor.selectionBackground"],
    cursor: c["editorCursor.foreground"],
    lineHighlight: c["editor.lineHighlightBackground"],
    match: c["editor.findMatchHighlightBackground"],
    matchActive: c["editor.findMatchBackground"],
    keyword: lookup(["keyword.control", "keyword", "storage.type", "storage"]),
    string: lookup(["string.quoted", "string"]),
    number: lookup(["constant.numeric"]),
    constant: lookup(["constant.language", "constant"]),
    comment: lookup(["comment.line", "comment"]),
    function: lookup(["entity.name.function", "support.function"]),
    variable: lookup(["variable.other", "variable"]),
    property: lookup(["variable.other.property", "support.type.property-name", "variable.other.object.property"]),
    type: lookup(["entity.name.type", "entity.name.class", "support.type", "support.class"]),
    operator: lookup(["keyword.operator"]),
    punctuation: lookup(["punctuation.separator", "punctuation"]),
    tag: lookup(["entity.name.tag"]),
    attribute: lookup(["entity.other.attribute-name"]),
    heading: lookup(["markup.heading", "entity.name.section"]),
    link: lookup(["markup.underline.link", "string.other.link"]),
    regexp: lookup(["string.regexp"]),
    inserted: lookup(["markup.inserted"]),
    deleted: lookup(["markup.deleted"]),
  };
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) if (v) colors[k] = v;
  const type = typeof json.type === "string" ? json.type : "";
  const dark = type ? !type.includes("light") : luminance(bg) < 0.4;
  const name = typeof json.name === "string" ? json.name : file.replace(/^.*[\\/]/, "").replace(/\.json$/i, "");
  return { name, dark, colors };
}

/** Theme file contents for "Customize current theme". */
export function themeToFile(theme: ThemeDef, name: string): string {
  return JSON.stringify({ name, dark: theme.dark, colors: theme.colors }, null, 2) + "\n";
}
