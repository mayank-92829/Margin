import { closeSearchPanel, openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { EditorSelection, Text, type EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { boot } from "./boot";
import { detectIndent } from "./editor/extras";
import { getView } from "./editor/instance";
import { detectLanguage, languageByName, loadLanguage } from "./editor/languages";
import { countWords } from "./editor/transforms";
import { configKey, createEditorState, ensureVim, isVimLoaded, languageEffect, onEditorUpdate, reconfigureEffects, type EditorConfig } from "./editor/view";
import { ipc, parseError, type Eol, type FileStat } from "./ipc";
import { basename, dirname, extname, normalize, resolvePath, samePath } from "./path";
import { loadSettingsText, settings, settingsFor, settingsMeta, type ViewMode } from "./settings.svelte";
import { reloadCustomThemes } from "./theme.svelte";
import { ask, toast, ui } from "./ui.svelte";

export interface Tab {
  id: string;
  path: string | null;
  title: string;
  kind: "text" | "large";
  encoding: string;
  bom: boolean;
  /** Encoding chosen with "Reopen with encoding"; null means auto-detect. */
  forcedEncoding: string | null;
  eol: Eol;
  dirty: boolean;
  /** Encoding or line endings changed since the last save. */
  metaDirty: boolean;
  readOnly: boolean;
  binary: boolean;
  lossy: boolean;
  language: string | null;
  languageAuto: boolean;
  indent: { spaces: boolean; size: number } | null;
  viewMode: ViewMode;
  loaded: boolean;
  loading: boolean;
  stat: FileStat | null;
  external: "modified" | "deleted" | null;
  large: { id: number; size: number; encoding: string } | null;
}

interface TabData {
  state: EditorState | null;
  saved: Text | null;
  scroll: StateEffect<unknown> | null;
  configKey: string;
  language: Extension;
  /** Document last written to the backup file (identity check). */
  backedUp: Text | null;
  hasBackup: boolean;
  pendingSelection: { anchor: number; head: number } | null;
}

export const tabsState = $state({
  list: [] as Tab[],
  activeId: "",
  recent: [] as string[],
});

export const status = $state({ line: 1, col: 1, selected: 0, cursors: 1, words: 0, chars: 0, selWords: 0 });

/** Bumped whenever the document in the editor view changes (the preview listens to it). */
export const docSignal = $state({ version: 0 });

const data = new Map<string, TabData>();
/** Which tab's state the editor view currently holds. */
let viewTabId = "";
const closed: string[] = [];
const MAX_RECENT = 15;
const MAX_TEXT_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------- basics

export function activeTab(): Tab | undefined {
  return tabsState.list.find((t) => t.id === tabsState.activeId);
}

export function findTab(id: string): Tab | undefined {
  return tabsState.list.find((t) => t.id === id);
}

function tabData(tab: Tab): TabData {
  let d = data.get(tab.id);
  if (!d) {
    d = { state: null, saved: null, scroll: null, configKey: "", language: [], backedUp: null, hasBackup: false, pendingSelection: null };
    data.set(tab.id, d);
  }
  return d;
}

/** The live editor state of a tab (the view's state when it is the active tab). */
export function stateOf(tab: Tab): EditorState | null {
  const view = getView();
  if (view && tab.id === viewTabId) return view.state;
  return data.get(tab.id)?.state ?? null;
}

/** True when the editor view is showing this tab. */
export function inView(tab: Tab | undefined): boolean {
  return !!tab && !!getView() && tab.id === viewTabId;
}

export function isMarkdown(tab: Tab | undefined): boolean {
  return tab?.language === "Markdown";
}

function newId(): string {
  return crypto.randomUUID();
}

function untitledTitle(doc: Text | null): string {
  if (!doc) return "Untitled";
  const n = Math.min(doc.lines, 20);
  for (let i = 1; i <= n; i++) {
    const text = doc.line(i).text.replace(/^[#>*\-\s]+/, "").trim();
    if (text) return text.length > 36 ? text.slice(0, 36).trimEnd() + "…" : text;
  }
  return "Untitled";
}

function makeTab(init: Partial<Tab>): Tab {
  return {
    id: newId(),
    path: null,
    title: "Untitled",
    kind: "text",
    encoding: settings.defaultEncoding,
    bom: false,
    forcedEncoding: null,
    eol: settings.defaultEol,
    dirty: false,
    metaDirty: false,
    readOnly: false,
    binary: false,
    lossy: false,
    language: null,
    languageAuto: true,
    indent: null,
    viewMode: "source",
    loaded: false,
    loading: false,
    stat: null,
    external: null,
    large: null,
    ...init,
  };
}

function insertTab(tab: Tab, after: string | null = tabsState.activeId): Tab {
  const i = tabsState.list.findIndex((t) => t.id === after);
  if (i < 0) tabsState.list.push(tab);
  else tabsState.list.splice(i + 1, 0, tab);
  // Return the reactive proxy so later mutations update the UI.
  return tabsState.list.find((t) => t.id === tab.id)!;
}

export function editorConfigFor(tab: Tab): EditorConfig {
  const fs = settingsFor(tab.path, isMarkdown(tab) ? "markdown" : "other");
  const indent = tab.indent ?? (fs.insertSpaces ? { spaces: true, size: fs.tabSize } : { spaces: false, size: fs.tabSize });
  return {
    wordWrap: fs.wordWrap,
    lineNumbers: fs.lineNumbers,
    codeFolding: fs.codeFolding,
    highlightActiveLine: fs.highlightActiveLine,
    showWhitespace: fs.showWhitespace,
    highlightTrailingWhitespace: fs.highlightTrailingWhitespace,
    tabSize: indent.spaces ? indent.size : indent.size || fs.tabSize,
    insertSpaces: indent.spaces,
    autoCloseBrackets: fs.autoCloseBrackets,
    bracketMatching: fs.bracketMatching,
    highlightSelectionMatches: fs.highlightSelectionMatches,
    syntaxHighlighting: fs.syntaxHighlighting,
    spellcheck: fs.spellcheck,
    readOnly: tab.readOnly,
    vim: settings.keymap === "vim",
    focusMode: fs.focusMode,
    typewriterMode: fs.typewriterMode,
    scrollPastEnd: fs.scrollPastEnd,
    cursorBlink: settings.cursorBlink,
  };
}

async function languageFor(tab: Tab): Promise<Extension> {
  const desc = tab.language ? languageByName(tab.language) : null;
  if (!desc) return [];
  try {
    return await loadLanguage(desc);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- editor view

/** Puts the active tab's state into the editor view. */
export function mountActive(): void {
  const view = getView();
  const tab = activeTab();
  if (!view || !tab || tab.kind !== "text" || !tab.loaded) return;
  const d = tabData(tab);
  if (!d.state) return;
  if (viewTabId !== tab.id || view.state !== d.state) {
    view.setState(d.state);
    viewTabId = tab.id;
    docSignal.version++;
    if (d.scroll) view.dispatch({ effects: d.scroll });
  }
  syncConfig(tab);
  if (ui.find.open) openSearchPanel(view);
  else if (searchPanelOpen(view.state)) closeSearchPanel(view);
  updateStatus(view.state, true);
}

/** Applies changed settings to a tab's editor state (lazily, when the tab is shown). */
export function syncConfig(tab: Tab | undefined = activeTab()): void {
  if (!tab || tab.kind !== "text" || !tab.loaded) return;
  const cfg = editorConfigFor(tab);
  if (cfg.vim && !isVimLoaded()) {
    ensureVim()
      .then(() => syncConfig(activeTab()))
      .catch((e) => toast("Couldn't load Vim mode: " + parseError(e).message, { kind: "error" }));
  }
  const key = configKey(cfg);
  const d = tabData(tab);
  if (d.configKey === key) return;
  d.configKey = key;
  const state = stateOf(tab);
  if (!state) return;
  const view = getView();
  if (view && tab.id === viewTabId) {
    view.dispatch({ effects: reconfigureEffects(cfg) });
    d.state = view.state;
  } else {
    d.state = state.update({ effects: reconfigureEffects(cfg) }).state;
  }
}

/** Saves the view's state and scroll position back to the tab it belongs to. */
function stashActive(): void {
  const view = getView();
  const d = viewTabId ? data.get(viewTabId) : undefined;
  if (view && d && d.state) {
    d.state = view.state;
    d.scroll = view.scrollSnapshot();
  }
}

export async function activate(id: string): Promise<void> {
  const next = findTab(id);
  if (!next) return;
  if (tabsState.activeId !== id) {
    stashActive();
    tabsState.activeId = id;
  }
  if (!next.loaded && !next.loading) await loadTab(next);
  if (tabsState.activeId === id) {
    mountActive();
    if (next.path && next.loaded) checkExternalChanges([next]);
  }
}

export function cycleTab(delta: number): void {
  const list = tabsState.list;
  if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === tabsState.activeId);
  activate(list[(i + delta + list.length) % list.length].id);
}

export function activateIndex(i: number): void {
  const list = tabsState.list;
  const tab = i < 0 || i >= list.length ? list[list.length - 1] : list[i];
  if (tab) activate(tab.id);
}

export function moveTab(from: number, to: number): void {
  const list = tabsState.list;
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  const [t] = list.splice(from, 1);
  list.splice(to, 0, t);
  scheduleSession();
}

// ---------------------------------------------------------------- editor updates

let docTimer: ReturnType<typeof setTimeout> | undefined;
let statusFrame = 0;
let wordsTimer: ReturnType<typeof setTimeout> | undefined;

function refreshDirty(tab: Tab): void {
  const state = stateOf(tab);
  if (!state) return;
  const saved = tabData(tab).saved;
  const contentDirty = saved ? state.doc.length !== saved.length || !state.doc.eq(saved) : state.doc.length > 0;
  tab.dirty = contentDirty || tab.metaDirty;
  if (!tab.path) tab.title = untitledTitle(state.doc);
}

function updateStatus(state: EditorState, recount = false): void {
  cancelAnimationFrame(statusFrame);
  statusFrame = requestAnimationFrame(() => {
    const sel = state.selection;
    const head = sel.main.head;
    const line = state.doc.lineAt(head);
    status.line = line.number;
    status.col = head - line.from + 1;
    status.cursors = sel.ranges.length;
    status.selected = sel.ranges.reduce((n, r) => n + (r.to - r.from), 0);
    status.chars = state.doc.length;
  });
  clearTimeout(wordsTimer);
  wordsTimer = setTimeout(
    () => {
      status.words = state.doc.length <= 4_000_000 ? countWords(state.doc.toString()) : -1;
      const sel = state.selection.main;
      status.selWords = !sel.empty && sel.to - sel.from < 2_000_000 ? countWords(state.sliceDoc(sel.from, sel.to)) : 0;
    },
    recount ? 0 : 250,
  );
}

onEditorUpdate((u: ViewUpdate) => {
  const tab = findTab(viewTabId);
  if (!tab || tab.kind !== "text") return;
  const d = data.get(tab.id);
  if (!d || !d.state) return;
  if (u.docChanged) {
    docSignal.version++;
    // Mark dirty on the first keystroke; refine (e.g. undo back to saved) shortly after.
    if (!tab.dirty) refreshDirty(tab);
    clearTimeout(docTimer);
    docTimer = setTimeout(() => {
      if (!findTab(tab.id)) return;
      refreshDirty(tab);
      scheduleSession(true);
      scheduleAutoSave(tab);
    }, 150);
  }
  if (u.docChanged || u.selectionSet) updateStatus(u.state, false);
});

// ---------------------------------------------------------------- creating & loading

export function newTab(content = ""): Tab {
  const tab = insertTab(makeTab({ loaded: true }));
  const d = tabData(tab);
  d.state = createEditorState(content, editorConfigFor(tab), []);
  d.configKey = configKey(editorConfigFor(tab));
  if (content) refreshDirty(tab);
  activate(tab.id);
  scheduleSession();
  return tab;
}

function isBlankUntitled(tab: Tab | undefined): boolean {
  if (!tab || tab.path || tab.dirty || tab.kind !== "text" || !tab.loaded) return false;
  return (stateOf(tab)?.doc.length ?? 0) === 0;
}

interface ReadOptions {
  backup?: string | null;
  selection?: { anchor: number; head: number } | null;
  forceText?: boolean;
}

async function readIntoTab(tab: Tab, opts: ReadOptions = {}): Promise<void> {
  const path = tab.path!;
  const max = opts.forceText ? MAX_TEXT_BYTES : settings.largeFileMB * 1024 * 1024;
  const opened = await ipc.readTextFile(path, max, tab.forcedEncoding ?? undefined);
  if (opened.content === null) {
    if (opts.backup != null) {
      // Unsaved edits to a file that has since grown huge: keep the edits.
      await loadUntitledLike(tab, opts.backup);
      return;
    }
    await openLarge(tab, opened.stat);
    return;
  }
  tab.kind = "text";
  tab.encoding = opened.encoding;
  tab.bom = opened.bom;
  tab.eol = opened.eol || settings.defaultEol;
  tab.binary = opened.binary;
  tab.readOnly = opened.binary || tab.readOnly;
  tab.lossy = opened.lossy;
  tab.stat = opened.stat;
  tab.external = null;
  tab.metaDirty = false;
  if (tab.languageAuto) tab.language = detectLanguage(path)?.name ?? null;
  const diskDoc = Text.of(opened.content.split(/\r\n?|\n/));
  const doc = opts.backup != null ? Text.of(opts.backup.split(/\r\n?|\n/)) : diskDoc;
  const fs = settingsFor(path, isMarkdown(tab) ? "markdown" : "other");
  tab.indent = fs.detectIndentation ? detectIndent(doc) : null;
  const language = await languageFor(tab);
  const cfg = editorConfigFor(tab);
  const d = tabData(tab);
  d.language = language;
  d.saved = diskDoc;
  d.state = createEditorState(doc, cfg, language, opts.selection ?? undefined);
  d.configKey = configKey(cfg);
  d.scroll = null;
  if (opts.backup != null) d.backedUp = d.state.doc;
  tab.loaded = true;
  tab.dirty = opts.backup != null && !d.state.doc.eq(diskDoc);
  if (opened.mixedEol) toast(`${tab.title} has mixed line endings — saving will use ${tab.eol}.`);
}

async function loadUntitledLike(tab: Tab, content: string): Promise<void> {
  tab.kind = "text";
  tab.language = tab.languageAuto ? (detectLanguage(tab.path)?.name ?? null) : tab.language;
  const language = await languageFor(tab);
  const cfg = editorConfigFor(tab);
  const d = tabData(tab);
  d.language = language;
  d.saved = null;
  d.state = createEditorState(content, cfg, language, d.pendingSelection ?? undefined);
  d.configKey = configKey(cfg);
  d.backedUp = d.state.doc;
  tab.loaded = true;
  tab.dirty = true;
  if (!tab.path) tab.title = untitledTitle(d.state.doc);
}

async function openLarge(tab: Tab, stat: FileStat): Promise<void> {
  try {
    const l = await ipc.largeOpen(tab.path!);
    tab.kind = "large";
    tab.large = l;
    tab.encoding = l.encoding;
    tab.readOnly = true;
    tab.stat = stat;
    tab.loaded = true;
    tab.language = null;
  } catch (e) {
    const err = parseError(e);
    if (err.code === "UTF16" && stat.size <= MAX_TEXT_BYTES) {
      await readIntoTab(tab, { forceText: true });
      return;
    }
    throw new Error(err.message);
  }
}

/** Loads a tab restored from the last session (done lazily, the first time it's shown). */
async function loadTab(tab: Tab): Promise<void> {
  tab.loading = true;
  const d = tabData(tab);
  try {
    const backup = d.hasBackup ? await ipc.readBackup(tab.id) : null;
    if (tab.path) {
      const meta = { encoding: tab.encoding, bom: tab.bom, eol: tab.eol, metaDirty: tab.metaDirty };
      try {
        await readIntoTab(tab, { backup, selection: d.pendingSelection });
        if (backup != null && meta.metaDirty) {
          Object.assign(tab, { encoding: meta.encoding, bom: meta.bom, eol: meta.eol, metaDirty: true, dirty: true });
        }
      } catch (e) {
        if (backup == null) throw e;
        await loadUntitledLike(tab, backup);
        tab.external = "deleted";
      }
    } else if (backup != null) {
      await loadUntitledLike(tab, backup);
    } else {
      // An untitled tab with nothing saved: start it empty.
      d.state = createEditorState("", editorConfigFor(tab), []);
      d.configKey = configKey(editorConfigFor(tab));
      tab.loaded = true;
    }
    d.pendingSelection = null;
  } catch (e) {
    toast(`Couldn't reopen ${tab.title}: ${parseError(e).message}`, { kind: "error" });
    removeTab(tab, false);
  } finally {
    tab.loading = false;
  }
}

function addRecent(path: string): void {
  tabsState.recent = [path, ...tabsState.recent.filter((p) => !samePath(p, path))].slice(0, MAX_RECENT);
}

export function clearRecent(): void {
  tabsState.recent = [];
  scheduleSession();
}

export async function openFile(path: string, activateIt = true): Promise<Tab | null> {
  path = normalize(path);
  const existing = tabsState.list.find((t) => t.path && samePath(t.path, path));
  if (existing) {
    if (activateIt) await activate(existing.id);
    return existing;
  }
  const current = activeTab();
  const replace = isBlankUntitled(current) ? current : undefined;
  const md = detectLanguage(path)?.name === "Markdown";
  const tab = insertTab(
    makeTab({ path, title: basename(path), loading: true, viewMode: md ? settingsFor(path, "markdown").markdownView : "source" }),
  );
  if (replace) removeTab(replace, false, false);
  if (activateIt) {
    stashActive();
    tabsState.activeId = tab.id;
  }
  try {
    await readIntoTab(tab);
    addRecent(path);
  } catch (e) {
    toast(`Couldn't open ${basename(path)}: ${parseError(e).message}`, { kind: "error" });
    removeTab(tab, false);
    return null;
  } finally {
    tab.loading = false;
  }
  if (tabsState.activeId === tab.id) mountActive();
  scheduleSession();
  return tab;
}

export async function openPaths(paths: string[]): Promise<void> {
  let last: Tab | null = null;
  for (const p of paths) last = (await openFile(p, paths.length === 1)) ?? last;
  if (last && paths.length > 1) await activate(last.id);
}

function lastDir(): string | undefined {
  const tab = activeTab();
  if (tab?.path) return dirname(tab.path);
  return tabsState.recent[0] ? dirname(tabsState.recent[0]) : undefined;
}

export async function openWithDialog(): Promise<void> {
  const res = await openDialog({ multiple: true, directory: false, defaultPath: lastDir() });
  if (!res) return;
  await openPaths(Array.isArray(res) ? res : [res]);
}

/** Large file → regular editor (for files that fit in memory). */
export async function openLargeInEditor(tab: Tab): Promise<void> {
  if (!tab.large || !tab.path) return;
  if (tab.large.size > MAX_TEXT_BYTES) {
    toast("This file is too large to edit in memory.", { kind: "error" });
    return;
  }
  const id = tab.large.id;
  tab.loading = true;
  try {
    tab.readOnly = false;
    await readIntoTab(tab, { forceText: true });
    ipc.largeClose(id).catch(() => {});
    tab.large = null;
    if (tabsState.activeId === tab.id) mountActive();
  } catch (e) {
    tab.readOnly = true;
    toast(`Couldn't open in editor: ${parseError(e).message}`, { kind: "error" });
  } finally {
    tab.loading = false;
  }
}

// ---------------------------------------------------------------- saving

const saving = new Map<string, Promise<boolean>>();

function suggestedName(tab: Tab): string {
  const base = tab.path ? basename(tab.path) : untitledTitle(stateOf(tab)?.doc ?? null).replace(/[\\/:*?"<>|…]+/g, "").trim().slice(0, 60) || "Untitled";
  if (tab.path) return base;
  return base + (isMarkdown(tab) ? ".md" : ".txt");
}

async function pickSavePath(tab: Tab): Promise<string | null> {
  const name = suggestedName(tab);
  const dir = tab.path ? dirname(tab.path) : lastDir();
  const text = { name: "Text Documents", extensions: ["txt"] };
  const md = { name: "Markdown", extensions: ["md"] };
  const all = { name: "All Files", extensions: ["*"] };
  const ext = extname(name);
  const filters = ext === "md" ? [md, text, all] : ext === "txt" || !ext ? [text, md, all] : [all, text, md];
  const p = await saveDialog({ defaultPath: dir ? resolvePath(dir, name) : name, filters });
  return p ?? null;
}

export function saveTab(tab: Tab, saveAs = false): Promise<boolean> {
  const prev = saving.get(tab.id) ?? Promise.resolve(true);
  const next = prev.then(() => doSave(tab, saveAs)).catch(() => false);
  saving.set(tab.id, next);
  next.finally(() => {
    if (saving.get(tab.id) === next) saving.delete(tab.id);
  });
  return next;
}

async function doSave(tab: Tab, saveAs: boolean): Promise<boolean> {
  if (tab.kind !== "text" || !tab.loaded) return false;
  if (tab.binary && tab.readOnly) {
    toast("This looks like a binary file, so it's read-only. Use “Edit anyway” to change it.");
    return false;
  }
  let path = tab.path;
  if (!path || saveAs) {
    path = await pickSavePath(tab);
    if (!path) return false;
  }
  return writeTab(tab, path);
}

function applySaveCleanup(tab: Tab, path: string): void {
  const fs = settingsFor(path, isMarkdown(tab) ? "markdown" : "other");
  const state = stateOf(tab);
  if (!state || (!fs.trimTrailingWhitespace && !fs.insertFinalNewline)) return;
  const changes: { from: number; to: number; insert: string }[] = [];
  if (fs.trimTrailingWhitespace) {
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const m = /[ \t]+$/.exec(line.text);
      if (m) changes.push({ from: line.to - m[0].length, to: line.to, insert: "" });
    }
  }
  if (fs.insertFinalNewline && state.doc.length > 0 && state.doc.line(state.doc.lines).text !== "") {
    changes.push({ from: state.doc.length, to: state.doc.length, insert: "\n" });
  }
  if (!changes.length) return;
  const view = getView();
  const spec = { changes, userEvent: "input.cleanup" };
  if (view && tab.id === viewTabId) view.dispatch(spec);
  else tabData(tab).state = state.update(spec).state;
}

async function writeTab(tab: Tab, path: string): Promise<boolean> {
  applySaveCleanup(tab, path);
  const state = stateOf(tab);
  if (!state) return false;
  const written = state.doc;
  try {
    const stat = await ipc.writeTextFile(path, written.toString(), tab.encoding, tab.bom, tab.eol);
    const d = tabData(tab);
    const pathChanged = !tab.path || !samePath(tab.path, path);
    d.saved = written;
    tab.path = path;
    tab.title = basename(path);
    tab.stat = stat;
    tab.metaDirty = false;
    tab.external = null;
    tab.forcedEncoding = null;
    refreshDirty(tab);
    addRecent(path);
    if (pathChanged && tab.languageAuto) {
      const lang = detectLanguage(path)?.name ?? null;
      if (lang !== tab.language) await setLanguage(tab, lang, true);
    }
    afterSave(path, written);
    scheduleSession(true);
    return true;
  } catch (e) {
    const { code, message } = parseError(e);
    if (code === "UNMAPPABLE") {
      const r = await ask({
        title: "Save as UTF-8?",
        message,
        detail: "UTF-8 can store every character.",
        buttons: [
          { label: "Cancel", value: "cancel" },
          { label: "Save as UTF-8", value: "utf8", primary: true },
        ],
        cancelValue: "cancel",
      });
      if (r !== "utf8") return false;
      tab.encoding = "UTF-8";
      tab.bom = false;
      return writeTab(tab, path);
    }
    if (code === "READONLY" || code === "DENIED") {
      const r = await ask({
        title: "Can't save here",
        message,
        buttons: [
          { label: "Cancel", value: "cancel" },
          { label: "Save As…", value: "as", primary: true },
        ],
        cancelValue: "cancel",
      });
      if (r !== "as") return false;
      const p = await pickSavePath(tab);
      return p ? writeTab(tab, p) : false;
    }
    toast(`Couldn't save ${basename(path)}: ${message}`, { kind: "error" });
    return false;
  }
}

function afterSave(path: string, doc: Text): void {
  if (boot.paths.settings && samePath(path, boot.paths.settings)) {
    if (loadSettingsText(doc.toString())) toast("Settings applied.");
    else toast(`settings.json has an error: ${settingsMeta.error}`, { kind: "error" });
  } else if (boot.paths.themes && normalize(path).toLowerCase().startsWith(normalize(boot.paths.themes).toLowerCase() + "\\")) {
    reloadCustomThemes().then(() => toast("Theme updated."));
  }
}

export async function saveAll(): Promise<void> {
  for (const tab of [...tabsState.list]) if (tab.dirty) await saveTab(tab);
}

let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleAutoSave(tab: Tab): void {
  if (settings.autoSave !== "delay" || !tab.path || !tab.dirty || tab.readOnly) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (tab.dirty && tab.path && findTab(tab.id)) saveTab(tab);
  }, settings.autoSaveDelay);
}

export function autoSaveOnBlur(): void {
  if (settings.autoSave !== "focus") return;
  for (const tab of tabsState.list) if (tab.dirty && tab.path && !tab.readOnly && tab.loaded) saveTab(tab);
}

// ---------------------------------------------------------------- closing

function removeTab(tab: Tab, remember = true, activateNext = true): void {
  const list = tabsState.list;
  const i = list.findIndex((t) => t.id === tab.id);
  if (i < 0) return;
  if (tab.large) ipc.largeClose(tab.large.id).catch(() => {});
  if (remember && tab.path) {
    const at = closed.findIndex((p) => samePath(p, tab.path!));
    if (at >= 0) closed.splice(at, 1);
    closed.push(tab.path);
    if (closed.length > 30) closed.shift();
  }
  list.splice(i, 1);
  data.delete(tab.id);
  if (viewTabId === tab.id) viewTabId = "";
  if (tabsState.activeId === tab.id) {
    tabsState.activeId = "";
    const next = list[i] ?? list[i - 1];
    if (next) activate(next.id);
    else if (activateNext) {
      if (settings.closeWindowWithLastTab) {
        getCurrentWindow().close();
        newTab();
      } else newTab();
    }
  }
  scheduleSession(true);
}

export async function closeTab(id: string): Promise<boolean> {
  const tab = findTab(id);
  if (!tab) return true;
  if (tab.dirty) {
    if (tabsState.activeId !== id) await activate(id);
    const r = await ask({
      title: `Save changes to “${tab.title}”?`,
      message: "Your changes will be lost if you don't save them.",
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Don't save", value: "discard", danger: true },
        { label: "Save", value: "save", primary: true },
      ],
      cancelValue: "cancel",
    });
    if (r === "cancel") return false;
    if (r === "save" && !(await saveTab(tab))) return false;
  }
  removeTab(tab);
  return true;
}

export async function closeTabs(ids: string[]): Promise<void> {
  for (const id of ids) if (!(await closeTab(id))) return;
}

export async function reopenClosed(): Promise<void> {
  const path = closed.pop();
  if (path) await openFile(path);
}

// ---------------------------------------------------------------- tab properties

export async function setLanguage(tab: Tab, name: string | null, auto = false): Promise<void> {
  tab.language = name;
  tab.languageAuto = auto;
  if (tab.kind !== "text" || !tab.loaded) return;
  const ext = await languageFor(tab);
  const d = tabData(tab);
  d.language = ext;
  const state = stateOf(tab);
  if (!state) return;
  const view = getView();
  if (view && tab.id === viewTabId) view.dispatch({ effects: languageEffect(ext) });
  else d.state = state.update({ effects: languageEffect(ext) }).state;
  d.configKey = "";
  syncConfig(tab);
  scheduleSession();
}

export function setEol(tab: Tab, eol: Eol): void {
  if (tab.eol === eol) return;
  tab.eol = eol;
  if (tab.path) {
    tab.metaDirty = true;
    tab.dirty = true;
  }
  scheduleSession(true);
}

export function setSaveEncoding(tab: Tab, encoding: string, bom: boolean): void {
  if (tab.encoding === encoding && tab.bom === bom) return;
  tab.encoding = encoding;
  tab.bom = bom;
  if (tab.path) {
    tab.metaDirty = true;
    tab.dirty = true;
  }
  scheduleSession(true);
}

export function setIndent(tab: Tab, spaces: boolean, size: number): void {
  tab.indent = { spaces, size };
  tabData(tab).configKey = "";
  syncConfig(tab);
}

export function setViewMode(tab: Tab, mode: ViewMode): void {
  tab.viewMode = mode;
  scheduleSession();
}

export function allowEditing(tab: Tab): void {
  tab.readOnly = false;
  tabData(tab).configKey = "";
  syncConfig(tab);
}

export async function reloadTab(tab: Tab, encoding?: string | null): Promise<void> {
  if (!tab.path) return;
  if (tab.dirty) {
    const r = await ask({
      title: `Reload “${tab.title}”?`,
      message: "Your unsaved changes will be lost.",
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Reload", value: "reload", danger: true },
      ],
      cancelValue: "cancel",
    });
    if (r !== "reload") return;
  }
  if (encoding !== undefined) tab.forcedEncoding = encoding;
  const state = stateOf(tab);
  const sel = state?.selection.main;
  const view = getView();
  const scroll = view && tab.id === viewTabId ? view.scrollSnapshot() : tabData(tab).scroll;
  if (tab.large) {
    ipc.largeClose(tab.large.id).catch(() => {});
    tab.large = null;
  }
  try {
    tab.readOnly = false;
    await readIntoTab(tab, { selection: sel ? { anchor: sel.anchor, head: sel.head } : null });
    tabData(tab).scroll = scroll;
    // The view holds the old document; make it take the reloaded one.
    if (tab.id === viewTabId) viewTabId = "";
    if (tab.id === tabsState.activeId) mountActive();
  } catch (e) {
    toast(`Couldn't reload: ${parseError(e).message}`, { kind: "error" });
  }
}

export function keepMine(tab: Tab): void {
  tab.external = null;
  if (tab.path) {
    tab.metaDirty = true;
    tab.dirty = true;
  }
}

// ---------------------------------------------------------------- external changes

let checking = false;

/** Notices files changed or deleted by other programs (run on focus and tab switch). */
export async function checkExternalChanges(only?: Tab[]): Promise<void> {
  if (checking) return;
  const tabs = (only ?? tabsState.list).filter((t) => t.path && t.loaded && t.stat && !t.loading);
  if (!tabs.length) return;
  checking = true;
  try {
    const stats = await ipc.statFiles(tabs.map((t) => t.path!));
    tabs.forEach((tab, i) => {
      if (!findTab(tab.id) || saving.has(tab.id)) return;
      const s = stats[i];
      if (!s) {
        tab.external = "deleted";
        return;
      }
      if (tab.external === "deleted") tab.external = null;
      if (s.mtime === tab.stat!.mtime && s.size === tab.stat!.size) return;
      if (!tab.dirty && settings.autoReload && tab.kind === "text") {
        reloadTab(tab);
      } else if (tab.kind === "large") {
        tab.stat = s;
        reloadTab(tab);
      } else {
        tab.external = "modified";
        tab.stat = s;
      }
    });
  } catch {
    // Not critical; try again next time.
  } finally {
    checking = false;
  }
}

// ---------------------------------------------------------------- session

interface SessionTab {
  id: string;
  path: string | null;
  title: string;
  encoding: string;
  bom: boolean;
  forcedEncoding: string | null;
  eol: Eol;
  metaDirty: boolean;
  language: string | null;
  languageAuto: boolean;
  viewMode: ViewMode;
  dirty: boolean;
  hasBackup: boolean;
  selection: { anchor: number; head: number } | null;
}

interface SessionFile {
  version: 1;
  activeId: string;
  tabs: SessionTab[];
  closed: string[];
  recent: string[];
}

let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let sessionWithBackups = false;
let sessionChain: Promise<void> = Promise.resolve();

export function scheduleSession(withBackups = false): void {
  sessionWithBackups ||= withBackups;
  clearTimeout(sessionTimer);
  const size = activeTab() ? (stateOf(activeTab()!)?.doc.length ?? 0) : 0;
  // Bigger documents are backed up less often while typing.
  const delay = withBackups ? Math.min(10000, 1000 + size / 1000) : 600;
  sessionTimer = setTimeout(() => {
    const b = sessionWithBackups;
    sessionWithBackups = false;
    persistSession(b);
  }, delay);
}

export function persistSession(withBackups = true): Promise<void> {
  clearTimeout(sessionTimer);
  sessionChain = sessionChain.then(() => writeSession(withBackups)).catch((e) => console.error("Saving session failed", e));
  return sessionChain;
}

async function writeSession(withBackups: boolean): Promise<void> {
  const remember = settings.rememberUnsaved;
  const tabs: SessionTab[] = [];
  for (const tab of tabsState.list) {
    const d = tabData(tab);
    const state = stateOf(tab);
    if (tab.loaded && tab.kind === "text" && state) {
      if (remember && tab.dirty) {
        if (withBackups && d.backedUp !== state.doc) {
          await ipc.writeBackup(tab.id, state.doc.toString());
          d.backedUp = state.doc;
        }
        d.hasBackup = d.backedUp !== null;
      } else {
        d.hasBackup = false;
        d.backedUp = null;
      }
    } else if (!remember) {
      d.hasBackup = false;
    }
    const keep = settings.restoreSession ? !!tab.path || d.hasBackup : d.hasBackup;
    if (!keep) continue;
    const sel = state?.selection.main;
    tabs.push({
      id: tab.id,
      path: tab.path,
      title: tab.title,
      encoding: tab.encoding,
      bom: tab.bom,
      forcedEncoding: tab.forcedEncoding,
      eol: tab.eol,
      metaDirty: tab.metaDirty,
      language: tab.language,
      languageAuto: tab.languageAuto,
      viewMode: tab.viewMode,
      dirty: tab.dirty,
      hasBackup: d.hasBackup,
      selection: sel ? { anchor: sel.anchor, head: sel.head } : (d.pendingSelection ?? null),
    });
  }
  const file: SessionFile = { version: 1, activeId: tabsState.activeId, tabs, closed: closed.slice(-30), recent: tabsState.recent };
  await ipc.saveSession(JSON.stringify(file));
  await ipc.pruneBackups(tabs.filter((t) => t.hasBackup).map((t) => t.id));
}

export async function restoreSession(text: string | null): Promise<void> {
  let file: SessionFile | null = null;
  try {
    file = text ? (JSON.parse(text) as SessionFile) : null;
  } catch {
    file = null;
  }
  if (!file || file.version !== 1 || !Array.isArray(file.tabs)) return;
  tabsState.recent = Array.isArray(file.recent) ? file.recent.filter((p) => typeof p === "string").slice(0, MAX_RECENT) : [];
  if (Array.isArray(file.closed)) closed.push(...file.closed.filter((p) => typeof p === "string"));
  for (const st of file.tabs) {
    if (!st || typeof st.id !== "string") continue;
    if (!settings.restoreSession && !st.hasBackup) continue;
    if (!st.path && !st.hasBackup) continue;
    if (!settings.rememberUnsaved && !st.path) continue;
    const tab = insertTab(
      makeTab({
        id: st.id,
        path: st.path,
        title: st.title || (st.path ? basename(st.path) : "Untitled"),
        encoding: st.encoding || settings.defaultEncoding,
        bom: !!st.bom,
        forcedEncoding: st.forcedEncoding ?? null,
        eol: st.eol === "LF" || st.eol === "CR" || st.eol === "CRLF" ? st.eol : settings.defaultEol,
        metaDirty: !!st.metaDirty && settings.rememberUnsaved,
        language: st.language ?? null,
        languageAuto: st.languageAuto !== false,
        viewMode: st.viewMode === "preview" || st.viewMode === "split" ? st.viewMode : "source",
        dirty: !!st.dirty && st.hasBackup && settings.rememberUnsaved,
      }),
      tabsState.list[tabsState.list.length - 1]?.id ?? null,
    );
    const d = tabData(tab);
    d.hasBackup = !!st.hasBackup && settings.rememberUnsaved;
    d.pendingSelection = st.selection && typeof st.selection.anchor === "number" ? st.selection : null;
  }
  const active = findTab(file.activeId) ?? tabsState.list[tabsState.list.length - 1];
  if (active) await activate(active.id);
}

/** Called before the window closes. Returns false if the user cancelled. */
export async function prepareExit(): Promise<boolean> {
  stashActive();
  if (!settings.rememberUnsaved) {
    const dirty = tabsState.list.filter((t) => t.dirty);
    if (dirty.length) {
      const r = await ask({
        title: dirty.length === 1 ? `Save changes to “${dirty[0].title}”?` : `Save changes to ${dirty.length} files?`,
        message: "Your changes will be lost if you don't save them.",
        buttons: [
          { label: "Cancel", value: "cancel" },
          { label: "Don't save", value: "discard", danger: true },
          { label: dirty.length === 1 ? "Save" : "Save all", value: "save", primary: true },
        ],
        cancelValue: "cancel",
      });
      if (r === "cancel") return false;
      if (r === "save") {
        for (const t of dirty) if (!(await saveTab(t))) return false;
      }
    }
  }
  await persistSession(true);
  return true;
}

/** Text of the active tab's selection (single line), used to prefill find. */
export function selectedTextForFind(): string {
  const tab = activeTab();
  const state = tab ? stateOf(tab) : null;
  if (!state) return "";
  const sel = state.selection.main;
  if (sel.empty || sel.to - sel.from > 500) return "";
  const text = state.sliceDoc(sel.from, sel.to);
  return text.includes("\n") ? "" : text;
}

/** Toggles a markdown task checkbox on a given source line (0-based). */
export function toggleTaskAt(line: number): void {
  const view = getView();
  const tab = activeTab();
  if (!view || !tab || !inView(tab) || tab.readOnly || line < 0 || line >= view.state.doc.lines) return;
  const l = view.state.doc.line(line + 1);
  const m = /^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])\]/.exec(l.text);
  if (!m) return;
  const pos = l.from + m[1].length;
  view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === " " ? "x" : " " }, userEvent: "input.toggle" });
}

export function selectLine(line: number): void {
  const view = getView();
  if (!view) return;
  const n = Math.max(1, Math.min(view.state.doc.lines, line));
  const l = view.state.doc.line(n);
  view.dispatch({ selection: EditorSelection.cursor(l.from), effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  view.focus();
}

export function closeFindHighlights(): void {
  const view = getView();
  if (view) closeSearchPanel(view);
}
