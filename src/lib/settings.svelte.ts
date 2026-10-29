import { ipc } from "./ipc";
import { parseJsonc } from "./jsonc";
import { extname } from "./path";

export type ViewMode = "source" | "preview" | "split";

export interface Settings {
  // Appearance
  themeMode: "system" | "light" | "dark";
  lightTheme: string;
  darkTheme: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  ligatures: boolean;
  zoom: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  textWidth: number;
  showStatusBar: boolean;
  reduceMotion: boolean;
  // Editor
  wordWrap: boolean;
  lineNumbers: boolean;
  highlightActiveLine: boolean;
  showWhitespace: boolean;
  highlightTrailingWhitespace: boolean;
  tabSize: number;
  insertSpaces: boolean;
  detectIndentation: boolean;
  autoCloseBrackets: boolean;
  bracketMatching: boolean;
  codeFolding: boolean;
  highlightSelectionMatches: boolean;
  syntaxHighlighting: boolean;
  spellcheck: boolean;
  scrollPastEnd: boolean;
  keymap: "default" | "vim";
  // Markdown
  markdownView: ViewMode;
  previewFont: "sans" | "serif" | "mono";
  previewFontSize: number;
  previewWidth: number;
  syncScroll: boolean;
  renderMath: boolean;
  renderDiagrams: boolean;
  // Files
  defaultEncoding: string;
  defaultEol: "CRLF" | "LF";
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  restoreSession: boolean;
  rememberUnsaved: boolean;
  autoSave: "off" | "delay" | "focus";
  autoSaveDelay: number;
  autoReload: boolean;
  largeFileMB: number;
  closeWindowWithLastTab: boolean;
  // Writing
  focusMode: boolean;
  typewriterMode: boolean;
  showWordCount: boolean;
  // Advanced (settings.json only)
  overrides: Record<string, Partial<Settings>>;
  keybindings: Record<string, string>;
}

export const DEFAULTS: Settings = {
  themeMode: "system",
  lightTheme: "margin-light",
  darkTheme: "margin-dark",
  fontFamily: "JetBrains Mono",
  fontSize: 15,
  lineHeight: 1.6,
  letterSpacing: 0,
  ligatures: true,
  zoom: 100,
  cursorStyle: "bar",
  cursorBlink: true,
  textWidth: 0,
  showStatusBar: true,
  reduceMotion: false,

  wordWrap: true,
  lineNumbers: false,
  highlightActiveLine: false,
  showWhitespace: false,
  highlightTrailingWhitespace: false,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: true,
  autoCloseBrackets: true,
  bracketMatching: true,
  codeFolding: false,
  highlightSelectionMatches: true,
  syntaxHighlighting: true,
  spellcheck: false,
  scrollPastEnd: false,
  keymap: "default",

  markdownView: "preview",
  previewFont: "sans",
  previewFontSize: 16,
  previewWidth: 760,
  syncScroll: true,
  renderMath: true,
  renderDiagrams: true,

  defaultEncoding: "UTF-8",
  defaultEol: "CRLF",
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  restoreSession: true,
  rememberUnsaved: true,
  autoSave: "off",
  autoSaveDelay: 1000,
  autoReload: true,
  largeFileMB: 10,
  closeWindowWithLastTab: false,

  focusMode: false,
  typewriterMode: false,
  showWordCount: true,

  overrides: {
    md: { wordWrap: true },
  },
  keybindings: {},
};

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  themeMode: ["system", "light", "dark"],
  cursorStyle: ["bar", "block", "underline"],
  keymap: ["default", "vim"],
  markdownView: ["source", "preview", "split"],
  previewFont: ["sans", "serif", "mono"],
  defaultEol: ["CRLF", "LF"],
  autoSave: ["off", "delay", "focus"],
};

const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  fontSize: [8, 48],
  lineHeight: [1, 3],
  letterSpacing: [-2, 4],
  zoom: [50, 300],
  textWidth: [0, 400],
  tabSize: [1, 16],
  previewFontSize: [10, 32],
  previewWidth: [400, 2000],
  autoSaveDelay: [200, 60000],
  largeFileMB: [1, 2048],
};

/** Settings that only affect the editor and may differ per file type. */
export const PER_FILE_KEYS = [
  "fontFamily", "fontSize", "lineHeight", "letterSpacing", "ligatures", "textWidth",
  "wordWrap", "lineNumbers", "highlightActiveLine", "showWhitespace", "highlightTrailingWhitespace",
  "tabSize", "insertSpaces", "detectIndentation", "autoCloseBrackets", "bracketMatching", "codeFolding",
  "highlightSelectionMatches", "syntaxHighlighting", "spellcheck", "scrollPastEnd",
  "trimTrailingWhitespace", "insertFinalNewline", "markdownView", "focusMode", "typewriterMode",
] as const satisfies readonly (keyof Settings)[];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export const settings: Settings = $state(clone(DEFAULTS));

export const settingsMeta = $state({
  /** Parse error in settings.json; while set, the file is never overwritten. */
  error: null as string | null,
});

function validValue(key: keyof Settings, value: unknown): boolean {
  const def = DEFAULTS[key];
  if (typeof value !== typeof def) return false;
  if (ENUMS[key] && !ENUMS[key]!.includes(value as string)) return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  if (typeof def === "object" && (value === null || Array.isArray(value))) return false;
  return true;
}

function clampValue(key: keyof Settings, value: unknown): unknown {
  const r = RANGES[key];
  return r && typeof value === "number" ? Math.min(r[1], Math.max(r[0], value)) : value;
}

function sanitizePartial(obj: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key in DEFAULTS && key !== "overrides" && key !== "keybindings" && validValue(key as keyof Settings, obj[key])) {
      out[key] = clampValue(key as keyof Settings, obj[key]);
    }
  }
  return out as Partial<Settings>;
}

/** Applies settings.json text. Returns false (and keeps current settings) if it doesn't parse. */
export function loadSettingsText(text: string | null): boolean {
  if (text === null || text.trim() === "") {
    settingsMeta.error = null;
    return true;
  }
  let obj: unknown;
  try {
    obj = parseJsonc(text);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new Error("settings.json must contain an object");
  } catch (e) {
    settingsMeta.error = e instanceof Error ? e.message : String(e);
    return false;
  }
  const o = obj as Record<string, unknown>;
  const next = { ...clone(DEFAULTS), ...sanitizePartial(o) } as Settings;
  if (o.overrides && typeof o.overrides === "object" && !Array.isArray(o.overrides)) {
    next.overrides = {};
    for (const [ext, val] of Object.entries(o.overrides as Record<string, unknown>)) {
      if (val && typeof val === "object") next.overrides[ext.replace(/^\./, "").toLowerCase()] = sanitizePartial(val as Record<string, unknown>);
    }
  }
  if (o.keybindings && typeof o.keybindings === "object" && !Array.isArray(o.keybindings)) {
    next.keybindings = {};
    for (const [id, key] of Object.entries(o.keybindings as Record<string, unknown>)) {
      if (typeof key === "string") next.keybindings[id] = key;
    }
  }
  Object.assign(settings, next);
  settingsMeta.error = null;
  return true;
}

export function serializeSettings(): string {
  return JSON.stringify($state.snapshot(settings), null, 2) + "\n";
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function persistSettings(): void {
  if (settingsMeta.error) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ipc.saveSettings(serializeSettings()).catch((e) => console.error("Saving settings failed", e));
  }, 250);
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = clampValue(key, value) as Settings[K];
  persistSettings();
}

export function resetSettings(): void {
  settingsMeta.error = null;
  Object.assign(settings, clone(DEFAULTS));
  persistSettings();
}

export type FileSettings = Pick<Settings, (typeof PER_FILE_KEYS)[number]>;

/** Settings for a particular file, with any per-extension overrides applied. */
export function settingsFor(path: string | null, kind: "markdown" | "other"): FileSettings {
  const base: Record<string, unknown> = {};
  for (const k of PER_FILE_KEYS) base[k] = settings[k];
  const ext = path ? extname(path) : kind === "markdown" ? "md" : "";
  const over = ext ? settings.overrides[ext] : undefined;
  if (over) {
    for (const k of PER_FILE_KEYS) if (k in over) base[k] = (over as Record<string, unknown>)[k];
  }
  return base as FileSettings;
}
