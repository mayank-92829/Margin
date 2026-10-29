import { copyLineDown, deleteLine, moveLineDown, moveLineUp, toggleComment } from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { selectSelectionMatches } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { boot } from "./boot";
import { getView } from "./editor/instance";
import { detectLanguage, languages } from "./editor/languages";
import * as tx from "./editor/transforms";
import { ENCODINGS, encodingLabel } from "./encodings";
import { ipc, parseError } from "./ipc";
import { parseJsonc } from "./jsonc";
import { basename, dirname } from "./path";
import { serializeSettings, setSetting, settings, settingsMeta, type Settings } from "./settings.svelte";
import {
  activateIndex,
  activeTab,
  allowEditing,
  clearRecent,
  closeTab,
  closeTabs,
  cycleTab,
  inView,
  isMarkdown,
  newTab,
  openFile,
  openWithDialog,
  reloadTab,
  reopenClosed,
  saveAll,
  saveTab,
  selectLine,
  selectedTextForFind,
  setEol,
  setIndent,
  setLanguage,
  setSaveEncoding,
  setViewMode,
  stateOf,
  syncConfig,
  tabsState,
  type Tab,
} from "./tabs.svelte";
import { allThemes, currentTheme, findTheme, isDarkMode, reloadCustomThemes, themeState } from "./theme.svelte";
import { fromVSCode, themeToFile, type ThemeDef } from "./themes";
import { ask, openPalette, toast, ui, type PaletteItem } from "./ui.svelte";

export interface Command {
  id: string;
  title: string;
  category: string;
  /** Global shortcuts handled by Margin. */
  keys?: string[];
  /** Shortcut shown for reference only (handled inside the editor). */
  hint?: string;
  run: () => unknown;
}

// ---------------------------------------------------------------- helpers

function textTab(): Tab | undefined {
  const t = activeTab();
  return t && t.kind === "text" && t.loaded ? t : undefined;
}

/** Runs an editor command on the active tab, reporting errors (e.g. invalid JSON) as a toast. */
function edit(fn: (v: EditorView) => boolean | void) {
  return () => {
    const v = getView();
    const t = textTab();
    if (!v || !t || !inView(t)) return;
    if (t.readOnly) {
      toast("This tab is read-only.");
      return;
    }
    try {
      fn(v);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: "error" });
    }
    v.focus();
  };
}

function toggle(key: keyof Settings & string, label: string) {
  return () => {
    const next = !settings[key];
    setSetting(key, next as never);
    syncConfig();
    toast(`${label} ${next ? "on" : "off"}`, { ms: 1400 });
  };
}

const ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

function zoom(dir: 1 | -1 | 0): void {
  if (dir === 0) return setSetting("zoom", 100);
  const z = settings.zoom;
  const next = dir > 0 ? ZOOMS.find((v) => v > z) : [...ZOOMS].reverse().find((v) => v < z);
  if (next) setSetting("zoom", next);
}

export function openFind(replace: boolean): void {
  const sel = selectedTextForFind();
  if (sel) ui.find.query = sel;
  ui.find.open = true;
  ui.find.replace = replace && textTab() !== undefined && !(textTab()!.viewMode === "preview" && isMarkdown(textTab()));
  ui.find.focusToken++;
}

export const findApi: { next?: () => void; prev?: () => void } = {};

function findStep(dir: 1 | -1): void {
  if (!ui.find.open || !ui.find.query) {
    openFind(false);
    return;
  }
  (dir > 0 ? findApi.next : findApi.prev)?.();
}

function markdownMode(mode: "source" | "preview" | "split" | "toggle"): void {
  const t = textTab();
  if (!t) return;
  if (!isMarkdown(t)) {
    toast("Preview is available for Markdown files. Change the language to Markdown to use it.");
    return;
  }
  const next = mode === "toggle" ? (t.viewMode === "source" ? "preview" : "source") : mode;
  setViewMode(t, next);
  if (next !== "preview") requestAnimationFrame(() => getView()?.focus());
}

async function toggleZen(): Promise<void> {
  ui.zen = !ui.zen;
  try {
    await getCurrentWindow().setFullscreen(ui.zen);
  } catch {
    // Fullscreen is cosmetic here; zen mode still hides the chrome.
  }
  if (ui.zen) toast("Zen mode — press F11 or Esc to exit", { ms: 2200 });
}

export function exitZen(): void {
  if (ui.zen) toggleZen();
}

async function toggleAlwaysOnTop(): Promise<void> {
  ui.alwaysOnTop = !ui.alwaysOnTop;
  await getCurrentWindow().setAlwaysOnTop(ui.alwaysOnTop);
  toast(`Always on top ${ui.alwaysOnTop ? "on" : "off"}`, { ms: 1400 });
}

export function chooseTheme(theme: ThemeDef): void {
  if (theme.dark) setSetting("darkTheme", theme.id);
  else setSetting("lightTheme", theme.id);
  const keepSystem = settings.themeMode === "system" && themeState.systemDark === theme.dark;
  if (!keepSystem) setSetting("themeMode", theme.dark ? "dark" : "light");
}

function toggleDarkLight(): void {
  setSetting("themeMode", isDarkMode() ? "light" : "dark");
}

function showStats(): void {
  const t = textTab();
  const state = t ? stateOf(t) : null;
  if (!state) return;
  const sel = state.selection.main;
  const text = sel.empty ? state.doc.toString() : state.sliceDoc(sel.from, sel.to);
  const s = tx.textStats(text);
  const minutes = Math.max(1, Math.round(s.words / 230));
  ask({
    title: sel.empty ? "Document statistics" : "Selection statistics",
    message: [
      `Words: ${s.words.toLocaleString()}`,
      `Characters: ${s.characters.toLocaleString()} (${s.charactersNoSpaces.toLocaleString()} without spaces)`,
      `Lines: ${s.lines.toLocaleString()}`,
      `Paragraphs: ${s.paragraphs.toLocaleString()}`,
      `Reading time: about ${minutes} min`,
    ].join("\n"),
    buttons: [{ label: "OK", value: "ok", primary: true }],
    cancelValue: "ok",
  });
}

function about(): void {
  ask({
    title: "Margin",
    message: `Version ${boot.version}`,
    detail: "A fast, minimal text editor. Settings and themes live in:\n" + boot.paths.config,
    buttons: [
      { label: "Open settings folder", value: "folder" },
      { label: "OK", value: "ok", primary: true },
    ],
    cancelValue: "ok",
  }).then((v) => {
    if (v === "folder") openPath(boot.paths.config).catch((e) => toast(parseError(e).message, { kind: "error" }));
  });
}

async function openSettingsFile(): Promise<void> {
  if (settingsMeta.error === null) await ipc.saveSettings(serializeSettings());
  await openFile(boot.paths.settings);
}

function printActive(): void {
  const t = activeTab();
  const root = document.getElementById("print-root");
  if (!t || !root) return;
  if (t.kind !== "text") {
    toast("Large files can't be printed.");
    return;
  }
  root.replaceChildren();
  const preview = document.querySelector(".preview-body");
  if (isMarkdown(t) && t.viewMode !== "source" && preview) {
    const article = document.createElement("article");
    article.className = "preview-body";
    article.innerHTML = preview.innerHTML;
    root.appendChild(article);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = stateOf(t)?.doc.toString() ?? "";
    root.appendChild(pre);
  }
  const clear = () => {
    root.replaceChildren();
    window.removeEventListener("afterprint", clear);
  };
  window.addEventListener("afterprint", clear);
  window.print();
}

async function customizeTheme(): Promise<void> {
  const base = currentTheme();
  const name = base.file ? base.name : `${base.name} Custom`;
  const path = base.file ?? (await ipc.saveTheme(name, themeToFile(base, name)));
  await reloadCustomThemes();
  const created = themeState.custom.find((x) => x.file === path);
  if (created) chooseTheme(created);
  await openFile(path);
  toast("Edit the colors and save — the theme updates instantly.");
}

async function importVSCodeTheme(): Promise<void> {
  const res = await openDialog({ multiple: false, filters: [{ name: "VS Code color theme", extensions: ["json", "jsonc"] }] });
  if (!res || Array.isArray(res)) return;
  try {
    const file = await ipc.readTextFile(res, 20 * 1024 * 1024);
    const json = parseJsonc(file.content ?? "") as Record<string, unknown>;
    const converted = fromVSCode(json, res);
    const path = await ipc.saveTheme(converted.name, JSON.stringify(converted, null, 2) + "\n");
    await reloadCustomThemes();
    const theme = themeState.custom.find((x) => x.file === path);
    if (!theme) throw new Error("That file doesn't look like a color theme.");
    chooseTheme(theme);
    toast(`Imported “${theme.name}”.`);
  } catch (e) {
    toast(`Couldn't import theme: ${parseError(e).message}`, { kind: "error" });
  }
}

// ---------------------------------------------------------------- pickers

export function pickTheme(): void {
  const current = currentTheme().id;
  const items: PaletteItem[] = allThemes().map((t) => ({ id: t.id, label: t.name, detail: t.file ? "Custom" : t.dark ? "Dark" : "Light", current: t.id === current }));
  openPalette({
    placeholder: "Choose a theme (↑↓ to preview)",
    items,
    onHighlight: (item) => (themeState.preview = item?.id ?? null),
    onSelect: (item) => {
      themeState.preview = null;
      const t = findTheme(item.id);
      if (t) chooseTheme(t);
    },
    onCancel: () => (themeState.preview = null),
  });
}

export function pickRecent(): void {
  const items = tabsState.recent.map((p) => ({ id: p, label: basename(p), detail: dirname(p) }));
  openPalette({
    placeholder: "Open recent file",
    items,
    emptyText: "No recent files yet",
    onSelect: (item) => openFile(item.id),
  });
}

export function pickLanguage(): void {
  const t = textTab();
  if (!t) return;
  const auto = detectLanguage(t.path)?.name ?? "Plain Text";
  const items: PaletteItem[] = [
    { id: "__auto", label: "Auto Detect", detail: auto, current: t.languageAuto },
    { id: "__plain", label: "Plain Text", current: !t.languageAuto && !t.language },
    ...[...languages]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => ({ id: l.name, label: l.name, detail: l.extensions.slice(0, 4).map((e) => "." + e).join(" "), current: !t.languageAuto && t.language === l.name })),
  ];
  openPalette({
    placeholder: "Select language mode",
    items,
    onSelect: (item) => {
      if (item.id === "__auto") setLanguage(t, detectLanguage(t.path)?.name ?? null, true);
      else setLanguage(t, item.id === "__plain" ? null : item.id, false);
    },
  });
}

export function pickEncoding(mode: "reopen" | "save"): void {
  const t = activeTab();
  if (!t) return;
  if (mode === "reopen" && !t.path) {
    toast("Save the file first to reopen it with another encoding.");
    return;
  }
  const current = encodingLabel(t.encoding, t.bom);
  openPalette({
    placeholder: mode === "reopen" ? "Reopen with encoding" : "Save with encoding",
    items: ENCODINGS.map((e, i) => ({ id: String(i), label: e.label, current: encodingLabel(e.encoding, e.bom) === current })),
    onSelect: (item) => {
      const e = ENCODINGS[Number(item.id)];
      if (mode === "reopen") reloadTab(t, e.encoding);
      else setSaveEncoding(t, e.encoding, e.bom);
    },
  });
}

export function encodingMenu(): void {
  const t = activeTab();
  if (!t) return;
  openPalette({
    placeholder: `Encoding: ${encodingLabel(t.encoding, t.bom)}`,
    items: [
      { id: "save", label: "Save with Encoding…", detail: "Changes how the file is written" },
      { id: "reopen", label: "Reopen with Encoding…", detail: "Fixes garbled characters" },
    ],
    onSelect: (item) => setTimeout(() => pickEncoding(item.id as "save" | "reopen")),
  });
}

export function pickEol(): void {
  const t = textTab();
  if (!t) return;
  const opts = [
    { id: "CRLF", label: "CRLF", detail: "Windows" },
    { id: "LF", label: "LF", detail: "macOS, Linux" },
    { id: "CR", label: "CR", detail: "Classic Mac" },
  ];
  openPalette({
    placeholder: "Select line ending",
    items: opts.map((o) => ({ ...o, current: t.eol === o.id })),
    onSelect: (item) => setEol(t, item.id as "CRLF" | "LF" | "CR"),
  });
}

export function pickIndent(): void {
  const t = textTab();
  if (!t) return;
  const items: PaletteItem[] = [
    ...[2, 3, 4, 8].map((n) => ({ id: `s${n}`, label: `Spaces: ${n}` })),
    ...[2, 4, 8].map((n) => ({ id: `t${n}`, label: `Tabs: ${n}`, detail: "Tab width" })),
  ];
  openPalette({
    placeholder: "Indentation",
    items,
    onSelect: (item) => setIndent(t, item.id[0] === "s", Number(item.id.slice(1))),
  });
}

export function gotoLine(): void {
  const t = textTab();
  const state = t ? stateOf(t) : null;
  if (!t || !state) return;
  if (t.viewMode === "preview" && isMarkdown(t)) setViewMode(t, "source");
  const cur = state.doc.lineAt(state.selection.main.head).number;
  openPalette({
    placeholder: `Go to line (1–${state.doc.lines.toLocaleString()}), currently ${cur}`,
    items: (q) => {
      const n = parseInt(q.replace(/[^\d]/g, ""), 10);
      if (!q.trim()) return [{ id: "", label: `Type a line number between 1 and ${state.doc.lines.toLocaleString()}` }];
      if (!Number.isFinite(n)) return [];
      return [{ id: String(n), label: `Go to line ${Math.min(n, state.doc.lines).toLocaleString()}` }];
    },
    onSelect: (item) => {
      if (item.id) selectLine(Number(item.id));
    },
  });
}

export function openCommandPalette(): void {
  openPalette({
    placeholder: "Type a command",
    items: commands.filter((c) => !c.id.startsWith("tab.goto") && c.category !== "Hidden").map((c) => ({ id: c.id, label: c.title, detail: c.category, hint: shortcutLabel(c) })),
    onSelect: (item) => setTimeout(() => runCommand(item.id)),
  });
}

// ---------------------------------------------------------------- the registry

export const commands: Command[] = [
  // File
  { id: "file.new", title: "New Tab", category: "File", keys: ["Ctrl+N", "Ctrl+T"], run: () => newTab() },
  { id: "file.open", title: "Open…", category: "File", keys: ["Ctrl+O"], run: openWithDialog },
  { id: "file.openRecent", title: "Open Recent…", category: "File", keys: ["Ctrl+R"], run: pickRecent },
  { id: "file.save", title: "Save", category: "File", keys: ["Ctrl+S"], run: () => activeTab() && saveTab(activeTab()!) },
  { id: "file.saveAs", title: "Save As…", category: "File", keys: ["Ctrl+Shift+S"], run: () => activeTab() && saveTab(activeTab()!, true) },
  { id: "file.saveAll", title: "Save All", category: "File", keys: ["Ctrl+Alt+S"], run: saveAll },
  { id: "file.close", title: "Close Tab", category: "File", keys: ["Ctrl+W", "Ctrl+F4"], run: () => activeTab() && closeTab(activeTab()!.id) },
  { id: "file.closeOthers", title: "Close Other Tabs", category: "File", run: () => closeTabs(tabsState.list.filter((t) => t.id !== tabsState.activeId).map((t) => t.id)) },
  { id: "file.closeSaved", title: "Close Saved Tabs", category: "File", run: () => closeTabs(tabsState.list.filter((t) => !t.dirty).map((t) => t.id)) },
  { id: "file.closeAll", title: "Close All Tabs", category: "File", run: () => closeTabs(tabsState.list.map((t) => t.id)) },
  { id: "file.reopenClosed", title: "Reopen Closed Tab", category: "File", keys: ["Ctrl+Shift+T"], run: reopenClosed },
  { id: "file.reload", title: "Reload from Disk", category: "File", run: () => activeTab() && reloadTab(activeTab()!) },
  { id: "file.reopenEncoding", title: "Reopen with Encoding…", category: "File", run: () => pickEncoding("reopen") },
  { id: "file.saveEncoding", title: "Save with Encoding…", category: "File", run: () => pickEncoding("save") },
  { id: "file.eol", title: "Change Line Endings…", category: "File", run: pickEol },
  { id: "file.reveal", title: "Reveal in File Explorer", category: "File", run: () => activeTab()?.path && revealItemInDir(activeTab()!.path!) },
  {
    id: "file.copyPath",
    title: "Copy File Path",
    category: "File",
    run: () => {
      const p = activeTab()?.path;
      if (p) navigator.clipboard.writeText(p).then(() => toast("Path copied", { ms: 1400 }));
    },
  },
  { id: "file.clearRecent", title: "Clear Recent Files", category: "File", run: clearRecent },
  { id: "file.print", title: "Print…", category: "File", keys: ["Ctrl+P"], run: printActive },
  { id: "window.close", title: "Close Window", category: "File", keys: ["Ctrl+Shift+W"], run: () => getCurrentWindow().close() },

  // Edit
  { id: "edit.find", title: "Find", category: "Edit", keys: ["Ctrl+F"], run: () => openFind(false) },
  { id: "edit.replace", title: "Replace", category: "Edit", keys: ["Ctrl+H"], run: () => openFind(true) },
  { id: "edit.findNext", title: "Find Next", category: "Edit", keys: ["F3"], run: () => findStep(1) },
  { id: "edit.findPrev", title: "Find Previous", category: "Edit", keys: ["Shift+F3"], run: () => findStep(-1) },
  { id: "edit.gotoLine", title: "Go to Line…", category: "Edit", keys: ["Ctrl+G"], run: gotoLine },
  { id: "edit.dateTime", title: "Insert Time/Date", category: "Edit", keys: ["F5"], run: edit(tx.insertDateTime) },
  { id: "edit.selectAllMatches", title: "Select All Occurrences", category: "Edit", hint: "Ctrl+Shift+L", run: edit(selectSelectionMatches) },
  { id: "edit.toggleComment", title: "Toggle Comment", category: "Edit", hint: "Ctrl+/", run: edit(toggleComment) },
  { id: "edit.duplicateLine", title: "Duplicate Line", category: "Edit", hint: "Shift+Alt+↓", run: edit(copyLineDown) },
  { id: "edit.moveLineUp", title: "Move Line Up", category: "Edit", hint: "Alt+↑", run: edit(moveLineUp) },
  { id: "edit.moveLineDown", title: "Move Line Down", category: "Edit", hint: "Alt+↓", run: edit(moveLineDown) },
  { id: "edit.deleteLine", title: "Delete Line", category: "Edit", hint: "Ctrl+Shift+K", run: edit(deleteLine) },
  { id: "edit.foldAll", title: "Fold All", category: "Edit", run: edit(foldAll) },
  { id: "edit.unfoldAll", title: "Unfold All", category: "Edit", run: edit(unfoldAll) },
  { id: "edit.stats", title: "Document Statistics", category: "Edit", run: showStats },
  {
    id: "edit.readOnly",
    title: "Toggle Read-Only",
    category: "Edit",
    run: () => {
      const t = textTab();
      if (!t) return;
      if (t.readOnly) allowEditing(t);
      else {
        t.readOnly = true;
        syncConfig(t);
      }
      toast(t.readOnly ? "Read-only" : "Editable", { ms: 1400 });
    },
  },

  // Text transforms
  { id: "text.sortAsc", title: "Sort Lines Ascending", category: "Text", run: edit(tx.sortAsc) },
  { id: "text.sortDesc", title: "Sort Lines Descending", category: "Text", run: edit(tx.sortDesc) },
  { id: "text.sortLength", title: "Sort Lines by Length", category: "Text", run: edit(tx.sortByLength) },
  { id: "text.reverse", title: "Reverse Lines", category: "Text", run: edit(tx.reverseLines) },
  { id: "text.unique", title: "Remove Duplicate Lines", category: "Text", run: edit(tx.uniqueLines) },
  { id: "text.shuffle", title: "Shuffle Lines", category: "Text", run: edit(tx.shuffleLines) },
  { id: "text.removeEmpty", title: "Remove Empty Lines", category: "Text", run: edit(tx.removeEmptyLines) },
  { id: "text.trim", title: "Trim Trailing Whitespace", category: "Text", run: edit(tx.trimTrailing) },
  { id: "text.join", title: "Join Lines", category: "Text", run: edit(tx.joinLines) },
  { id: "text.upper", title: "UPPERCASE", category: "Text", run: edit(tx.upperCase) },
  { id: "text.lower", title: "lowercase", category: "Text", run: edit(tx.lowerCase) },
  { id: "text.title", title: "Title Case", category: "Text", run: edit(tx.titleCase) },
  { id: "text.sentence", title: "Sentence case", category: "Text", run: edit(tx.sentenceCase) },
  { id: "text.tabsToSpaces", title: "Convert Indentation to Spaces", category: "Text", run: edit(tx.tabsToSpaces) },
  { id: "text.spacesToTabs", title: "Convert Indentation to Tabs", category: "Text", run: edit(tx.spacesToTabs) },
  { id: "text.formatJson", title: "Format JSON", category: "Text", run: edit(tx.formatJson) },
  { id: "text.minifyJson", title: "Minify JSON", category: "Text", run: edit(tx.minifyJson) },
  { id: "text.base64Encode", title: "Base64 Encode", category: "Text", run: edit(tx.base64Encode) },
  { id: "text.base64Decode", title: "Base64 Decode", category: "Text", run: edit(tx.base64Decode) },
  { id: "text.urlEncode", title: "URL Encode", category: "Text", run: edit(tx.urlEncode) },
  { id: "text.urlDecode", title: "URL Decode", category: "Text", run: edit(tx.urlDecode) },

  // View
  { id: "view.palette", title: "Command Palette", category: "View", keys: ["Ctrl+Shift+P", "F1"], run: openCommandPalette },
  { id: "view.settings", title: "Settings", category: "View", keys: ["Ctrl+,"], run: () => (ui.settingsOpen = true) },
  { id: "view.theme", title: "Change Theme…", category: "View", keys: ["Ctrl+Alt+T"], run: pickTheme },
  { id: "view.toggleDark", title: "Toggle Light / Dark", category: "View", keys: ["Ctrl+Alt+D"], run: toggleDarkLight },
  { id: "view.markdown", title: "Toggle Markdown Preview", category: "View", keys: ["Ctrl+E"], run: () => markdownMode("toggle") },
  { id: "view.markdownSplit", title: "Markdown: Side-by-Side", category: "View", keys: ["Ctrl+Shift+E"], run: () => markdownMode("split") },
  { id: "view.markdownSource", title: "Markdown: Source", category: "View", run: () => markdownMode("source") },
  { id: "view.markdownPreview", title: "Markdown: Preview", category: "View", run: () => markdownMode("preview") },
  { id: "view.language", title: "Change Language Mode…", category: "View", run: pickLanguage },
  { id: "view.indent", title: "Change Indentation…", category: "View", run: pickIndent },
  { id: "view.wordWrap", title: "Toggle Word Wrap", category: "View", keys: ["Alt+Z"], run: toggle("wordWrap", "Word wrap") },
  { id: "view.lineNumbers", title: "Toggle Line Numbers", category: "View", keys: ["Ctrl+Alt+L"], run: toggle("lineNumbers", "Line numbers") },
  { id: "view.whitespace", title: "Toggle Whitespace", category: "View", run: toggle("showWhitespace", "Whitespace") },
  { id: "view.activeLine", title: "Toggle Current Line Highlight", category: "View", run: toggle("highlightActiveLine", "Current line highlight") },
  { id: "view.folding", title: "Toggle Code Folding", category: "View", run: toggle("codeFolding", "Code folding") },
  { id: "view.spellcheck", title: "Toggle Spell Check", category: "View", run: toggle("spellcheck", "Spell check") },
  { id: "view.statusBar", title: "Toggle Status Bar", category: "View", run: () => setSetting("showStatusBar", !settings.showStatusBar) },
  { id: "view.focusMode", title: "Toggle Focus Mode", category: "View", run: toggle("focusMode", "Focus mode") },
  { id: "view.typewriter", title: "Toggle Typewriter Scrolling", category: "View", run: toggle("typewriterMode", "Typewriter scrolling") },
  { id: "view.zen", title: "Toggle Zen Mode", category: "View", keys: ["F11"], run: toggleZen },
  { id: "view.alwaysOnTop", title: "Toggle Always on Top", category: "View", run: toggleAlwaysOnTop },
  {
    id: "view.vim",
    title: "Toggle Vim Mode",
    category: "View",
    run: () => {
      setSetting("keymap", settings.keymap === "vim" ? "default" : "vim");
      syncConfig();
      toast(`Vim mode ${settings.keymap === "vim" ? "on" : "off"}`, { ms: 1400 });
    },
  },
  { id: "view.zoomIn", title: "Zoom In", category: "View", keys: ["Ctrl+=", "Ctrl+Shift+=", "Ctrl+NumpadAdd"], run: () => zoom(1) },
  { id: "view.zoomOut", title: "Zoom Out", category: "View", keys: ["Ctrl+-", "Ctrl+NumpadSubtract"], run: () => zoom(-1) },
  { id: "view.zoomReset", title: "Reset Zoom", category: "View", keys: ["Ctrl+0", "Ctrl+Numpad0"], run: () => zoom(0) },

  // Tabs
  { id: "tab.next", title: "Next Tab", category: "Tabs", keys: ["Ctrl+Tab", "Ctrl+PageDown"], run: () => cycleTab(1) },
  { id: "tab.prev", title: "Previous Tab", category: "Tabs", keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"], run: () => cycleTab(-1) },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `tab.goto${i + 1}`,
    title: i === 8 ? "Go to Last Tab" : `Go to Tab ${i + 1}`,
    category: "Tabs",
    keys: [`Ctrl+${i + 1}`],
    run: () => activateIndex(i === 8 ? -1 : i),
  })),

  // Themes & settings
  { id: "theme.customize", title: "Customize Current Theme", category: "Theme", run: customizeTheme },
  { id: "theme.import", title: "Import VS Code Theme…", category: "Theme", run: importVSCodeTheme },
  { id: "theme.openFolder", title: "Open Themes Folder", category: "Theme", run: () => openPath(boot.paths.themes).catch((e) => toast(parseError(e).message, { kind: "error" })) },
  { id: "settings.openJson", title: "Open Settings File (JSON)", category: "Preferences", run: openSettingsFile },
  { id: "help.shortcuts", title: "Keyboard Shortcuts", category: "Help", keys: ["Ctrl+K"], run: () => ((ui.settingsSection = "keyboard"), (ui.settingsOpen = true)) },
  { id: "help.about", title: "About Margin", category: "Help", run: about },
];

const byId = new Map(commands.map((c) => [c.id, c]));

export function runCommand(id: string): void {
  const c = byId.get(id);
  if (!c) return;
  try {
    const r = c.run();
    if (r instanceof Promise) r.catch((e) => toast(parseError(e).message, { kind: "error" }));
  } catch (e) {
    toast(parseError(e).message, { kind: "error" });
  }
}

// ---------------------------------------------------------------- shortcuts

const CODE_KEYS: Record<string, string> = {
  Equal: "=", Minus: "-", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
  BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
  NumpadAdd: "NumpadAdd", NumpadSubtract: "NumpadSubtract", Numpad0: "Numpad0",
};

/** Canonical name for a key press, e.g. "Ctrl+Shift+P". Uses physical keys so layouts don't matter. */
export function comboFromEvent(e: KeyboardEvent): string {
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function normalizeCombo(s: string): string {
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out = [];
  if (mods.has("ctrl") || mods.has("cmd") || mods.has("control")) out.push("Ctrl");
  if (mods.has("alt")) out.push("Alt");
  if (mods.has("shift")) out.push("Shift");
  out.push(key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  return out.join("+");
}

let keymapCache: { sig: string; map: Map<string, string> } | null = null;

function keyMap(): Map<string, string> {
  const sig = JSON.stringify(settings.keybindings);
  if (keymapCache?.sig === sig) return keymapCache.map;
  const map = new Map<string, string>();
  for (const c of commands) {
    const custom = settings.keybindings[c.id];
    const keys = custom !== undefined ? (custom ? [custom] : []) : (c.keys ?? []);
    for (const k of keys) map.set(normalizeCombo(k), c.id);
  }
  keymapCache = { sig, map };
  return map;
}

export function commandForCombo(combo: string): string | undefined {
  return keyMap().get(combo);
}

export function shortcutLabel(c: Command): string | undefined {
  const custom = settings.keybindings[c.id];
  if (custom !== undefined) return custom || undefined;
  return c.keys?.[0] ?? c.hint;
}
