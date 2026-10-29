import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec, type Extension, type Text } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  type ViewUpdate,
} from "@codemirror/view";
import { focusMode, typewriter } from "./extras";
import { highlighter } from "./highlight";

export interface EditorConfig {
  wordWrap: boolean;
  lineNumbers: boolean;
  codeFolding: boolean;
  highlightActiveLine: boolean;
  showWhitespace: boolean;
  highlightTrailingWhitespace: boolean;
  tabSize: number;
  insertSpaces: boolean;
  autoCloseBrackets: boolean;
  bracketMatching: boolean;
  highlightSelectionMatches: boolean;
  syntaxHighlighting: boolean;
  spellcheck: boolean;
  readOnly: boolean;
  vim: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  scrollPastEnd: boolean;
  cursorBlink: boolean;
}

const comp = {
  language: new Compartment(),
  wrap: new Compartment(),
  gutters: new Compartment(),
  activeLine: new Compartment(),
  whitespace: new Compartment(),
  indent: new Compartment(),
  brackets: new Compartment(),
  matching: new Compartment(),
  selectionMatches: new Compartment(),
  syntax: new Compartment(),
  attrs: new Compartment(),
  readOnly: new Compartment(),
  vim: new Compartment(),
  writing: new Compartment(),
  pastEnd: new Compartment(),
  cursor: new Compartment(),
};

let vimExtension: Extension | null = null;

/** Loads Vim keybindings on first use, so they cost nothing for everyone else. */
export async function ensureVim(): Promise<void> {
  if (vimExtension) return;
  const { vim } = await import("@replit/codemirror-vim");
  vimExtension = Prec.highest(vim({ status: true }));
}

export function isVimLoaded(): boolean {
  return vimExtension !== null;
}

function parts(cfg: EditorConfig): [Compartment, Extension][] {
  return [
    [comp.wrap, cfg.wordWrap ? EditorView.lineWrapping : []],
    [comp.gutters, [cfg.lineNumbers ? [lineNumbers(), cfg.highlightActiveLine ? highlightActiveLineGutter() : []] : [], cfg.codeFolding ? [codeFolding(), foldGutter()] : []]],
    [comp.activeLine, cfg.highlightActiveLine ? highlightActiveLine() : []],
    [comp.whitespace, [cfg.showWhitespace ? highlightWhitespace() : [], cfg.highlightTrailingWhitespace ? highlightTrailingWhitespace() : []]],
    [comp.indent, [EditorState.tabSize.of(cfg.tabSize), indentUnit.of(cfg.insertSpaces ? " ".repeat(cfg.tabSize) : "\t")]],
    [comp.brackets, cfg.autoCloseBrackets ? closeBrackets() : []],
    [comp.matching, cfg.bracketMatching ? bracketMatching() : []],
    [comp.selectionMatches, cfg.highlightSelectionMatches ? highlightSelectionMatches({ minSelectionLength: 2 }) : []],
    [comp.syntax, cfg.syntaxHighlighting ? syntaxHighlighting(highlighter) : []],
    [comp.attrs, EditorView.contentAttributes.of({ spellcheck: String(cfg.spellcheck), autocorrect: "off", autocapitalize: "off" })],
    [comp.readOnly, [EditorState.readOnly.of(cfg.readOnly), EditorView.editable.of(true)]],
    [comp.vim, cfg.vim && vimExtension ? vimExtension : []],
    [comp.writing, [cfg.focusMode ? focusMode : [], cfg.typewriterMode ? typewriter : []]],
    [comp.pastEnd, cfg.scrollPastEnd && !cfg.typewriterMode ? scrollPastEnd() : []],
    [comp.cursor, drawSelection({ cursorBlinkRate: cfg.cursorBlink ? 1100 : 0 })],
  ];
}

export function configKey(cfg: EditorConfig): string {
  return JSON.stringify(cfg) + (vimExtension ? "+vim" : "");
}

type UpdateHandler = (u: ViewUpdate) => void;
let updateHandler: UpdateHandler | null = null;

export function onEditorUpdate(fn: UpdateHandler): void {
  updateHandler = fn;
}

const updateListener = EditorView.updateListener.of((u) => updateHandler?.(u));

// Search highlighting in CodeMirror is tied to its search panel being open. Margin draws its
// own find bar, so the panel CodeMirror opens is an empty, hidden element.
const searchExtension = search({
  top: true,
  createPanel: () => {
    const dom = document.createElement("div");
    dom.className = "cm-hidden-panel";
    return { dom, top: true };
  },
  scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: "center" }),
});

const baseTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--fg)", backgroundColor: "var(--bg)", fontSize: "var(--editor-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--editor-font)",
    lineHeight: "var(--editor-lh)",
    letterSpacing: "var(--editor-ls)",
    fontVariantLigatures: "var(--editor-lig)",
    fontFeatureSettings: "var(--editor-features)",
  },
  ".cm-content": { padding: "16px 0 24px", caretColor: "var(--cursor)", maxWidth: "var(--text-width)", marginInline: "auto" },
  ".cm-line": { padding: "0 28px" },
  ".cm-gutters + .cm-content .cm-line": { paddingLeft: "12px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--cursor)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--line-hl)" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--gutter)", border: "none", paddingLeft: "10px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 8px", minWidth: "28px" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--faint)", padding: "0 4px", cursor: "pointer" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--surface-2)", border: "none", color: "var(--muted)", borderRadius: "4px", padding: "0 6px" },
  ".cm-searchMatch": { backgroundColor: "var(--match)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--match-active)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--match) 70%, transparent)", borderRadius: "2px" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--faint)", borderRadius: "2px" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "transparent", color: "var(--danger)" },
  ".cm-trailingSpace": { backgroundColor: "color-mix(in srgb, var(--danger) 22%, transparent)" },
  ".cm-highlightSpace, .cm-highlightTab": { opacity: "0.45" },
  ".cm-specialChar": { color: "var(--danger)" },
  ".cm-dimmed": { opacity: "0.3", transition: "opacity 0.18s ease" },
  ".cm-hidden-panel, .cm-panels-top": { display: "none" },
  ".cm-panels-bottom": { backgroundColor: "var(--surface)", borderTop: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--editor-font)" },
  ".cm-fat-cursor": { background: "var(--cursor) !important", color: "var(--bg) !important" },
  "&:not(.cm-focused) .cm-fat-cursor": { background: "none !important", outline: "1px solid var(--cursor) !important" },
});

const extraKeys = keymap.of([
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
]);

export function createEditorState(
  doc: string | Text,
  cfg: EditorConfig,
  language: Extension,
  selection?: { anchor: number; head: number },
): EditorState {
  const extensions: Extension[] = [
    comp.language.of(language),
    ...parts(cfg).map(([c, e]) => c.of(e)),
    history(),
    highlightSpecialChars(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    rectangularSelection(),
    crosshairCursor(),
    searchExtension,
    extraKeys,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    baseTheme,
    updateListener,
  ];
  const state = EditorState.create({ doc, extensions });
  if (!selection) return state;
  const len = state.doc.length;
  const clamp = (n: number) => Math.max(0, Math.min(len, n | 0));
  return state.update({ selection: EditorSelection.single(clamp(selection.anchor), clamp(selection.head)) }).state;
}

export function reconfigureEffects(cfg: EditorConfig) {
  return parts(cfg).map(([c, e]) => c.reconfigure(e));
}

export function languageEffect(language: Extension) {
  return comp.language.reconfigure(language);
}
