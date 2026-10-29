<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onDestroy, onMount, untrack } from "svelte";
  import { getView } from "../lib/editor/instance";
  import { findTargets } from "../lib/findTargets";
  import { dirname, resolvePath } from "../lib/path";
  import { settings } from "../lib/settings.svelte";
  import { docSignal, inView, openFile, stateOf, toggleTaskAt, type Tab } from "../lib/tabs.svelte";
  import { currentTheme } from "../lib/theme.svelte";
  import { toast } from "../lib/ui.svelte";

  let { tab, mode }: { tab: Tab; mode: "preview" | "split" } = $props();

  let scroller: HTMLDivElement | undefined = $state();
  let body: HTMLElement | undefined = $state();
  let tooBig = $state(false);
  let forced = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastDark: boolean | null = null;
  let lastTab = "";
  let firstRender = true;
  // Mode as of the last render/scroll; props already show the next mode when this unmounts.
  let previewOnly = false;
  const keys = new WeakMap<Node, string>();
  let lineEls: { line: number; el: HTMLElement }[] = [];

  type RenderMod = typeof import("../lib/markdown/render");
  type EnhanceMod = typeof import("../lib/markdown/enhance");
  let mods: Promise<[RenderMod, EnhanceMod]> | null = null;
  const load = () => (mods ??= Promise.all([import("../lib/markdown/render"), import("../lib/markdown/enhance")]));

  $effect(() => {
    void [docSignal.version, tab.id, settings.renderMath, settings.renderDiagrams];
    const dark = currentTheme().dark;
    untrack(() => schedule(dark));
  });

  function schedule(dark: boolean) {
    clearTimeout(timer);
    const len = stateOf(tab)?.doc.length ?? 0;
    const delay = firstRender || tab.id !== lastTab || dark !== lastDark ? 0 : len < 50_000 ? 40 : len < 500_000 ? 150 : 400;
    timer = setTimeout(() => render(dark), delay);
  }

  async function render(dark: boolean) {
    const state = stateOf(tab);
    if (!state || !body) return;
    if (state.doc.length > 5_000_000 && !forced) {
      tooBig = true;
      return;
    }
    tooBig = false;
    previewOnly = mode === "preview";
    const [{ renderMarkdown }, { enhance }] = await load();
    if (!body) return;
    const html = renderMarkdown(state.doc.toString(), { math: settings.renderMath, diagrams: settings.renderDiagrams });
    const reset = dark !== lastDark || tab.id !== lastTab;
    lastDark = dark;
    const switched = tab.id !== lastTab;
    lastTab = tab.id;
    const fresh = patch(body, html, reset);
    lineEls = [...body.querySelectorAll<HTMLElement>("[data-line]")].map((el) => ({ line: Number(el.dataset.line), el }));
    for (const n of fresh) if (n instanceof Element) enhance(n, dark).then(() => findTargets.preview?.onRender?.());
    findTargets.preview?.onRender?.();
    if (firstRender || switched) {
      firstRender = false;
      requestAnimationFrame(syncFromEditor);
    }
  }

  function keyOf(n: Node): string {
    return n instanceof Element ? n.outerHTML.replace(/ data-(?:line|task)="\d+"/g, "") : (n.textContent ?? "");
  }

  function fixImages(n: Node) {
    if (!(n instanceof Element)) return;
    const base = tab.path ? dirname(tab.path) : null;
    const imgs = n.tagName === "IMG" ? [n as HTMLImageElement] : [...n.querySelectorAll("img")];
    for (const img of imgs) {
      const src = img.getAttribute("src") ?? "";
      if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
      let path: string | null = null;
      if (/^file:/i.test(src)) path = decodeURI(src.replace(/^file:\/+/i, ""));
      else if (base) path = resolvePath(base, decodeURI(src.split(/[?#]/)[0]));
      if (path) img.setAttribute("src", convertFileSrc(path));
    }
  }

  /** Replaces only the top-level blocks that changed, so images and diagrams don't flicker. */
  function patch(root: HTMLElement, html: string, reset: boolean): Node[] {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const next = [...tpl.content.childNodes].filter((n) => n.nodeType !== Node.TEXT_NODE || n.textContent!.trim());
    const nextKeys = next.map(keyOf);
    if (reset) root.replaceChildren();
    const old = [...root.childNodes];
    let start = 0;
    while (start < old.length && start < next.length && keys.get(old[start]) === nextKeys[start]) start++;
    let endOld = old.length - 1;
    let endNew = next.length - 1;
    while (endOld >= start && endNew >= start && keys.get(old[endOld]) === nextKeys[endNew]) {
      endOld--;
      endNew--;
    }
    // Kept blocks still need up-to-date source line numbers.
    const sync = (o: Node, n: Node) => {
      if (!(o instanceof Element) || !(n instanceof Element)) return;
      const a = [o, ...o.querySelectorAll("[data-line],[data-task]")];
      const b = [n, ...n.querySelectorAll("[data-line],[data-task]")];
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        for (const attr of ["data-line", "data-task"]) {
          const v = b[i].getAttribute(attr);
          if (v !== null) a[i].setAttribute(attr, v);
        }
      }
    };
    for (let i = 0; i < start; i++) sync(old[i], next[i]);
    for (let i = 1; endOld + i < old.length; i++) sync(old[endOld + i], next[endNew + i]);
    const fresh = next.slice(start, endNew + 1);
    fresh.forEach((n, i) => {
      keys.set(n, nextKeys[start + i]);
      fixImages(n);
    });
    const anchor = old[endOld + 1] ?? null;
    for (let i = start; i <= endOld; i++) old[i].remove();
    for (const n of fresh) root.insertBefore(n, anchor);
    return fresh;
  }

  // ---- scroll sync with the editor (split view)

  let ignoreEditor = 0;
  let ignorePreview = 0;

  function offsetOf(el: HTMLElement): number {
    return el.getBoundingClientRect().top - scroller!.getBoundingClientRect().top + scroller!.scrollTop;
  }

  function previewTopForLine(line: number): number {
    if (!lineEls.length) return 0;
    let i = 0;
    while (i + 1 < lineEls.length && lineEls[i + 1].line <= line) i++;
    const a = lineEls[i];
    const b = lineEls[i + 1];
    const ya = offsetOf(a.el);
    if (!b || b.line === a.line || line < a.line) return ya;
    const yb = offsetOf(b.el);
    return ya + ((yb - ya) * (line - a.line)) / (b.line - a.line);
  }

  function lineForPreviewTop(y: number): number {
    if (!lineEls.length) return 0;
    let i = 0;
    while (i + 1 < lineEls.length && offsetOf(lineEls[i + 1].el) <= y) i++;
    const a = lineEls[i];
    const b = lineEls[i + 1];
    const ya = offsetOf(a.el);
    if (!b) return a.line;
    const yb = offsetOf(b.el);
    return yb > ya ? a.line + ((b.line - a.line) * Math.max(0, y - ya)) / (yb - ya) : a.line;
  }

  function editorTopLine(): number {
    const view = getView();
    if (!view || !inView(tab)) return 0;
    const top = view.scrollDOM.scrollTop;
    const block = view.lineBlockAtHeight(top);
    const line = view.state.doc.lineAt(block.from).number - 1;
    return line + (block.height ? Math.max(0, Math.min(1, (top - block.top) / block.height)) : 0);
  }

  function syncFromEditor() {
    if (!scroller) return;
    const line = editorTopLine();
    ignorePreview = performance.now() + 120;
    scroller.scrollTop = line <= 0 ? 0 : Math.max(0, previewTopForLine(line) - 24);
  }

  function onEditorScroll() {
    if (mode !== "split" || !settings.syncScroll || performance.now() < ignoreEditor) return;
    syncFromEditor();
  }

  function onPreviewScroll() {
    previewOnly = mode === "preview";
    if (mode !== "split" || !settings.syncScroll || performance.now() < ignorePreview || !scroller) return;
    const view = getView();
    if (!view || !inView(tab)) return;
    const line = lineForPreviewTop(scroller.scrollTop + 24);
    const n = Math.max(1, Math.min(view.state.doc.lines, Math.floor(line) + 1));
    const block = view.lineBlockAt(view.state.doc.line(n).from);
    ignoreEditor = performance.now() + 120;
    view.scrollDOM.scrollTop = scroller.scrollTop <= 0 ? 0 : block.top + (line % 1) * block.height;
  }

  // ---- links & checkboxes

  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const box = target.closest<HTMLInputElement>("input.task");
    if (box) {
      e.preventDefault();
      if (tab.readOnly) return;
      toggleTaskAt(Number(box.dataset.task));
      return;
    }
    const a = target.closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      body?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      openUrl(href).catch(() => toast("Couldn't open link", { kind: "error" }));
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) return;
    let path: string | null = null;
    if (/^file:/i.test(href)) path = decodeURI(href.replace(/^file:\/+/i, ""));
    else if (tab.path) path = resolvePath(dirname(tab.path), decodeURI(href.split("#")[0]));
    if (path) openFile(path);
  }

  onMount(() => {
    findTargets.preview = { root: body!, onRender: null };
    const view = getView();
    view?.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
    return () => view?.scrollDOM.removeEventListener("scroll", onEditorScroll);
  });

  onDestroy(() => {
    clearTimeout(timer);
    // Leaving preview: put the editor where the reader was.
    if (previewOnly && scroller && lineEls.length) {
      const view = getView();
      const atTop = scroller.scrollTop <= 0;
      const line = lineForPreviewTop(scroller.scrollTop + 24);
      if (view && inView(tab)) {
        const n = Math.max(1, Math.min(view.state.doc.lines, Math.floor(line) + 1));
        requestAnimationFrame(() => (view.scrollDOM.scrollTop = atTop ? 0 : view.lineBlockAt(view.state.doc.line(n).from).top));
      }
    }
    if (findTargets.preview?.root === body) findTargets.preview = null;
  });
</script>

<div class="preview" bind:this={scroller} onscroll={onPreviewScroll} tabindex="-1" role="document">
  {#if tooBig}
    <div class="big">
      <p>This document is very large, so the preview is paused.</p>
      <button
        class="btn"
        onclick={() => {
          forced = true;
          render(currentTheme().dark);
        }}>Render anyway</button
      >
    </div>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <article class="preview-body" bind:this={body} onclick={onClick}></article>
</div>


<style>
  .preview {
    width: 100%;
    height: 100%;
    min-width: 0;
    overflow: auto;
    outline: none;
    background: var(--bg);
    box-sizing: border-box;
  }

  .preview-body {
    width: 100%;
    max-width: none;
    margin-inline: 0;
    padding: 24px 32px;
    box-sizing: border-box;
  }

  .big {
    padding: 40px;
    text-align: center;
    color: var(--muted);
  }
</style>

