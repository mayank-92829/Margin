import { RangeSetBuilder, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/** Guesses indentation from the first lines of a document. */
export function detectIndent(doc: Text): { spaces: boolean; size: number } | null {
  let tabs = 0;
  let spaceLines = 0;
  const widths = new Map<number, number>();
  let prev = 0;
  const lines = Math.min(doc.lines, 2000);
  for (let i = 1; i <= lines; i++) {
    const text = doc.line(i).text;
    if (!text.trim()) continue;
    if (text[0] === "\t") {
      tabs++;
      continue;
    }
    const m = /^ +/.exec(text);
    const w = m ? m[0].length : 0;
    if (w > 0) spaceLines++;
    const diff = Math.abs(w - prev);
    if (diff >= 2 && diff <= 8) widths.set(diff, (widths.get(diff) ?? 0) + 1);
    prev = w;
  }
  if (tabs === 0 && spaceLines === 0) return null;
  if (tabs > spaceLines) return { spaces: false, size: 0 };
  let best = 0;
  let bestCount = 0;
  for (const [w, c] of widths) {
    if (c > bestCount || (c === bestCount && w < best)) {
      best = w;
      bestCount = c;
    }
  }
  return best ? { spaces: true, size: best } : null;
}

const dim = Decoration.line({ class: "cm-dimmed" });

function paragraphAround(view: EditorView): [number, number] {
  const doc = view.state.doc;
  const line = doc.lineAt(view.state.selection.main.head).number;
  if (!doc.line(line).text.trim()) return [line, line];
  let a = line;
  let b = line;
  while (a > 1 && doc.line(a - 1).text.trim()) a--;
  while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
  return [a, b];
}

/** Focus mode: everything outside the paragraph being edited fades back. */
export const focusMode = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const [a, b] = paragraphAround(view);
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          if (line.number < a || line.number > b) builder.add(line.from, line.from, dim);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/** Typewriter mode: keeps the line being edited in the middle of the screen. */
export const typewriter = [
  EditorView.updateListener.of((u) => {
    if (!u.selectionSet || !u.view.hasFocus) return;
    const head = u.state.selection.main.head;
    requestAnimationFrame(() => {
      if (u.view.state.selection.main.head === head) {
        u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
      }
    });
  }),
  EditorView.theme({ ".cm-content": { paddingBottom: "50vh !important" } }),
];
