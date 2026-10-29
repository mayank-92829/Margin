import type { EditorView } from "@codemirror/view";

// The app uses one editor view; switching tabs swaps its state.
let current: EditorView | null = null;

export function setView(v: EditorView | null): void {
  current = v;
}

export function getView(): EditorView | null {
  return current;
}
