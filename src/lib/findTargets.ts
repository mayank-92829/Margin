import type { LargeMatch } from "./ipc";

/** Views other than the editor register here so the find bar can search them. */
export const findTargets = {
  preview: null as null | { root: HTMLElement; onRender: (() => void) | null },
  large: null as null | { showMatch: (m: LargeMatch | null) => void; topLine: () => number },
};
