import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Line range covered by the main selection, or the whole document when nothing is selected. */
function targetLines(view: EditorView): { from: number; to: number } {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty) return { from: 0, to: state.doc.length };
  const first = state.doc.lineAt(sel.from);
  // A selection ending at the start of a line doesn't include that line.
  const lastPos = sel.to > sel.from && state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to;
  const last = state.doc.lineAt(lastPos);
  return { from: first.from, to: last.to };
}

export function mapLines(view: EditorView, fn: (lines: string[]) => string[]): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = targetLines(view);
  const text = view.state.sliceDoc(from, to);
  const next = fn(text.split("\n")).join("\n");
  if (next === text) return true;
  view.dispatch({
    changes: { from, to, insert: next },
    selection: EditorSelection.range(from, from + next.length),
    userEvent: "input.transform",
    scrollIntoView: true,
  });
  return true;
}

/** Applies `fn` to each selected range, or to the whole document when nothing is selected. */
export function mapText(view: EditorView, fn: (text: string) => string): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  const ranges = state.selection.ranges.every((r) => r.empty) ? [EditorSelection.range(0, state.doc.length)] : state.selection.ranges.filter((r) => !r.empty);
  const changes = ranges.map((r) => ({ from: r.from, to: r.to, insert: fn(state.sliceDoc(r.from, r.to)) }));
  const changeSet = state.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(ranges.map((r, i) => EditorSelection.range(changeSet.mapPos(r.from, -1), changeSet.mapPos(r.from, -1) + changes[i].insert.length))),
    userEvent: "input.transform",
  });
  return true;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const sortAsc = (v: EditorView) => mapLines(v, (l) => [...l].sort(collator.compare));
export const sortDesc = (v: EditorView) => mapLines(v, (l) => [...l].sort(collator.compare).reverse());
export const sortByLength = (v: EditorView) => mapLines(v, (l) => [...l].sort((a, b) => a.length - b.length));
export const reverseLines = (v: EditorView) => mapLines(v, (l) => [...l].reverse());
export const uniqueLines = (v: EditorView) => mapLines(v, (l) => [...new Set(l)]);
export const removeEmptyLines = (v: EditorView) => mapLines(v, (l) => l.filter((x) => x.trim() !== ""));
export const trimTrailing = (v: EditorView) => mapLines(v, (l) => l.map((x) => x.replace(/[ \t]+$/, "")));
export const joinLines = (v: EditorView) => mapLines(v, (l) => [l.map((x, i) => (i ? x.trim() : x.trimEnd())).join(" ")]);
export const shuffleLines = (v: EditorView) =>
  mapLines(v, (l) => {
    const a = [...l];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });

export const upperCase = (v: EditorView) => mapText(v, (s) => s.toUpperCase());
export const lowerCase = (v: EditorView) => mapText(v, (s) => s.toLowerCase());
export const titleCase = (v: EditorView) => mapText(v, (s) => s.toLowerCase().replace(/(^|[\s\-_(["'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()));
export const sentenceCase = (v: EditorView) => mapText(v, (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()));

export function tabsToSpaces(v: EditorView): boolean {
  const size = v.state.tabSize;
  return mapLines(v, (l) => l.map((x) => x.replace(/^[\t ]+/, (ws) => ws.replace(/\t/g, " ".repeat(size)))));
}

export function spacesToTabs(v: EditorView): boolean {
  const size = v.state.tabSize;
  return mapLines(v, (l) =>
    l.map((x) =>
      x.replace(/^[\t ]+/, (ws) => {
        const width = [...ws].reduce((w, c) => (c === "\t" ? w + size - (w % size) : w + 1), 0);
        return "\t".repeat(Math.floor(width / size)) + " ".repeat(width % size);
      }),
    ),
  );
}

export const formatJson = (v: EditorView) => mapText(v, (s) => JSON.stringify(JSON.parse(s), null, v.state.tabSize));
export const minifyJson = (v: EditorView) => mapText(v, (s) => JSON.stringify(JSON.parse(s)));

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): string {
  const bin = atob(s.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export const base64Encode = (v: EditorView) => mapText(v, toBase64);
export const base64Decode = (v: EditorView) => mapText(v, fromBase64);
export const urlEncode = (v: EditorView) => mapText(v, encodeURIComponent);
export const urlDecode = (v: EditorView) => mapText(v, decodeURIComponent);

/** Like Windows Notepad's F5: inserts the current time and date. */
export function insertDateTime(v: EditorView): boolean {
  if (v.state.readOnly) return false;
  const now = new Date();
  const text = `${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ${now.toLocaleDateString()}`;
  v.dispatch(v.state.replaceSelection(text), { userEvent: "input", scrollIntoView: true });
  return true;
}

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  paragraphs: number;
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}

export function textStats(text: string): TextStats {
  return {
    characters: [...text].length,
    charactersNoSpaces: text.replace(/\s+/g, "").length,
    words: countWords(text),
    lines: text.split("\n").length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
  };
}
