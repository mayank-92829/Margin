<script lang="ts">
  import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, SearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
  import { EditorSelection } from "@codemirror/state";
  import { tick, untrack } from "svelte";
  import { findApi } from "../lib/commands";
  import { getView } from "../lib/editor/instance";
  import { findTargets } from "../lib/findTargets";
  import { ipc, parseError, type LargeMatch } from "../lib/ipc";
  import { buildRegex, clearHighlights, findRanges, paintHighlights } from "../lib/markdown/find";
  import { activeTab, docSignal, inView, isMarkdown } from "../lib/tabs.svelte";
  import { toast, ui } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";

  const f = ui.find;
  const tab = $derived(activeTab());
  const mode = $derived(!tab || !tab.loaded ? "none" : tab.kind === "large" ? "large" : isMarkdown(tab) && tab.viewMode === "preview" ? "preview" : "editor");
  const canReplace = $derived(mode === "editor" && !tab?.readOnly);

  let input: HTMLInputElement | undefined = $state();
  let info = $state("");
  let invalid = $state(false);
  let busy = $state(false);
  let previewRanges: Range[] = [];
  let previewIndex = 0;
  let largeMatch: LargeMatch | null = null;

  $effect(() => {
    void f.focusToken;
    if (f.open) tick().then(() => {
      input?.focus();
      input?.select();
    });
  });

  // Re-run the search whenever the query, options, tab or view mode change.
  // Only a changed query moves the selection; switching tabs just re-highlights.
  let lastSig = "";
  $effect(() => {
    if (!f.open) {
      lastSig = "";
      return;
    }
    const sig = JSON.stringify([f.query, f.caseSensitive, f.wholeWord, f.regex]);
    void [f.replaceText, mode, tab?.id];
    untrack(() => {
      const jump = sig !== lastSig;
      lastSig = sig;
      apply(jump);
    });
  });

  // Keep the match count fresh while editing.
  let countTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void docSignal.version;
    if (!f.open) return;
    clearTimeout(countTimer);
    countTimer = setTimeout(() => untrack(() => mode === "editor" && updateCount()), 200);
  });

  function editorQuery(): SearchQuery {
    return new SearchQuery({ search: f.query, caseSensitive: f.caseSensitive, regexp: f.regex, wholeWord: f.wholeWord, replace: f.replaceText, literal: true });
  }

  function editorView() {
    const v = getView();
    return v && inView(tab) ? v : null;
  }

  function apply(jump: boolean) {
    clearHighlights();
    if (mode !== "large" && largeMatch) {
      largeMatch = null;
      findTargets.large?.showMatch(null);
    }
    if (mode === "editor") {
      const view = editorView();
      if (!view) return;
      if (!searchPanelOpen(view.state)) openSearchPanel(view);
      const q = editorQuery();
      view.dispatch({ effects: setSearchQuery.of(q) });
      invalid = !!f.query && !q.valid;
      if (jump && q.valid && f.query) {
        view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.from) });
        findNext(view);
      }
      updateCount();
    } else if (mode === "preview") {
      if (findTargets.preview) findTargets.preview.onRender = () => previewSearch(false);
      previewSearch(jump);
    } else if (mode === "large") {
      invalid = false;
      largeMatch = null;
      findTargets.large?.showMatch(null);
      info = f.query ? "Press Enter to search" : "";
    }
  }

  function updateCount() {
    const view = editorView();
    if (!view) return;
    const q = editorQuery();
    if (!f.query || !q.valid) {
      info = "";
      return;
    }
    const sel = view.state.selection.main;
    const cursor = q.getCursor(view.state);
    const t0 = performance.now();
    let total = 0;
    let current = 0;
    let capped = false;
    for (let r = cursor.next(); !r.done; r = cursor.next()) {
      total++;
      if (r.value.from === sel.from && r.value.to === sel.to) current = total;
      if (total >= 9999 || (total % 512 === 0 && performance.now() - t0 > 40)) {
        capped = true;
        break;
      }
    }
    const n = `${total.toLocaleString()}${capped ? "+" : ""}`;
    info = total === 0 ? "No results" : current ? `${current.toLocaleString()} of ${n}` : `${n} found`;
  }

  function previewSearch(jump: boolean) {
    const root = findTargets.preview?.root;
    if (!root) return;
    const re = buildRegex({ query: f.query, caseSensitive: f.caseSensitive, wholeWord: f.wholeWord, regex: f.regex });
    invalid = !!f.query && !re;
    previewRanges = re ? findRanges(root, re) : [];
    if (jump || previewIndex >= previewRanges.length) previewIndex = 0;
    paintHighlights(previewRanges, previewIndex);
    if (jump) scrollToRange(previewRanges[previewIndex]);
    info = !f.query ? "" : previewRanges.length ? `${previewIndex + 1} of ${previewRanges.length.toLocaleString()}` : "No results";
  }

  function scrollToRange(r: Range | undefined) {
    r?.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }

  async function largeStep(dir: 1 | -1) {
    const t = tab;
    if (!t?.large || !f.query || busy) return;
    const m0 = largeMatch;
    const from = m0
      ? dir > 0
        ? { line: m0.line, byte: m0.byteEnd > m0.byteStart ? m0.byteEnd : m0.byteEnd + 1 }
        : { line: m0.line, byte: m0.byteStart }
      : { line: findTargets.large?.topLine() ?? 0, byte: 0 };
    busy = true;
    info = "Searching…";
    try {
      const m = await ipc.largeSearch({
        id: t.large.id,
        query: f.query,
        regex: f.regex,
        caseSensitive: f.caseSensitive,
        wholeWord: f.wholeWord,
        fromLine: from.line,
        fromByte: from.byte,
        backward: dir < 0,
      });
      largeMatch = m;
      findTargets.large?.showMatch(m);
      info = m ? `Line ${(m.line + 1).toLocaleString()}${m.wrapped ? " · wrapped" : ""}` : "No results";
      invalid = false;
    } catch (e) {
      const msg = parseError(e).message;
      invalid = msg.startsWith("Invalid");
      info = invalid ? "Invalid pattern" : msg;
    } finally {
      busy = false;
    }
  }

  function step(dir: 1 | -1) {
    if (!f.query) return;
    if (mode === "editor") {
      const view = editorView();
      if (!view) return;
      apply(false);
      if (dir > 0) findNext(view);
      else findPrevious(view);
      updateCount();
    } else if (mode === "preview") {
      if (!previewRanges.length) return;
      previewIndex = (previewIndex + dir + previewRanges.length) % previewRanges.length;
      paintHighlights(previewRanges, previewIndex);
      scrollToRange(previewRanges[previewIndex]);
      info = `${previewIndex + 1} of ${previewRanges.length.toLocaleString()}`;
    } else if (mode === "large") {
      largeStep(dir);
    }
  }

  findApi.next = () => step(1);
  findApi.prev = () => step(-1);

  function replaceOne() {
    const view = editorView();
    if (!view || !canReplace || !f.query) return;
    apply(false);
    replaceNext(view);
    updateCount();
  }

  function replaceEvery() {
    const view = editorView();
    if (!view || !canReplace || !f.query) return;
    apply(false);
    const q = editorQuery();
    if (!q.valid) return;
    let n = 0;
    const cursor = q.getCursor(view.state);
    while (!cursor.next().done) n++;
    replaceAll(view);
    updateCount();
    toast(n ? `Replaced ${n.toLocaleString()} occurrence${n === 1 ? "" : "s"}` : "Nothing to replace", { ms: 1800 });
  }

  export function close() {
    f.open = false;
    clearHighlights();
    if (findTargets.preview) findTargets.preview.onRender = null;
    largeMatch = null;
    findTargets.large?.showMatch(null);
    const view = getView();
    if (view && searchPanelOpen(view.state)) closeSearchPanel(view);
    if (mode === "editor") view?.focus();
  }

  function onKey(e: KeyboardEvent, field: "find" | "replace") {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (field === "replace") {
        if (e.ctrlKey && e.altKey) replaceEvery();
        else replaceOne();
      } else step(e.shiftKey ? -1 : 1);
    } else if (e.altKey && !e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === "c") f.caseSensitive = !f.caseSensitive;
      else if (k === "w") f.wholeWord = !f.wholeWord;
      else if (k === "r") f.regex = !f.regex;
      else return;
      e.preventDefault();
    }
  }
</script>

{#if f.open && mode !== "none"}
  <div class="findbar" role="search">
    <button
      class="icon-btn expand"
      class:hidden={!canReplace}
      aria-label="Toggle replace"
      title="Toggle replace (Ctrl+H)"
      onclick={() => (f.replace = !f.replace)}
    >
      <span class="chev" class:open={f.replace}><Icon name="right" size={14} /></span>
    </button>
    <div class="rows">
      <div class="row">
        <div class="field" class:invalid>
          <input bind:this={input} bind:value={f.query} placeholder="Find" spellcheck="false" autocomplete="off" onkeydown={(e) => onKey(e, "find")} />
          <button class="opt" class:on={f.caseSensitive} title="Match case (Alt+C)" onclick={() => (f.caseSensitive = !f.caseSensitive)}>Aa</button>
          <button class="opt word" class:on={f.wholeWord} title="Whole word (Alt+W)" onclick={() => (f.wholeWord = !f.wholeWord)}>ab</button>
          <button class="opt" class:on={f.regex} title="Regular expression (Alt+R)" onclick={() => (f.regex = !f.regex)}>.*</button>
        </div>
        <span class="info" class:bad={info === "No results" || invalid}>{invalid ? "Invalid pattern" : info}</span>
        <button class="icon-btn" aria-label="Previous match" title="Previous (Shift+Enter)" onclick={() => step(-1)}><Icon name="up" /></button>
        <button class="icon-btn" aria-label="Next match" title="Next (Enter)" onclick={() => step(1)}><Icon name="down" /></button>
        <button class="icon-btn" aria-label="Close find" title="Close (Esc)" onclick={close}><Icon name="close" size={14} /></button>
      </div>
      {#if f.replace && canReplace}
        <div class="row">
          <div class="field">
            <input bind:value={f.replaceText} placeholder="Replace" spellcheck="false" autocomplete="off" onkeydown={(e) => onKey(e, "replace")} />
          </div>
          <button class="icon-btn" aria-label="Replace" title="Replace (Enter)" onclick={replaceOne}><Icon name="replace" /></button>
          <button class="icon-btn" aria-label="Replace all" title="Replace all (Ctrl+Alt+Enter)" onclick={replaceEvery}><Icon name="replaceAll" /></button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .findbar {
    position: absolute;
    top: 10px;
    right: 22px;
    z-index: 20;
    display: flex;
    align-items: flex-start;
    gap: 2px;
    padding: 5px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    animation: slide 0.14s var(--ease);
    max-width: calc(100% - 32px);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .field {
    display: flex;
    align-items: center;
    width: 280px;
    max-width: 40vw;
    height: 28px;
    padding: 0 3px 0 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    transition: border-color 0.12s;
  }
  .field:focus-within {
    border-color: var(--accent);
  }
  .field.invalid {
    border-color: var(--danger);
  }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    user-select: text;
  }
  input::placeholder {
    color: var(--faint);
  }
  .opt {
    height: 20px;
    min-width: 22px;
    padding: 0 4px;
    border-radius: 4px;
    color: var(--faint);
    font: 11.5px/20px var(--mono-font);
  }
  .opt.word {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .opt:hover {
    color: var(--fg);
    background: var(--surface-2);
  }
  .opt.on {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .info {
    min-width: 76px;
    padding: 0 8px;
    color: var(--faint);
    font-size: 12px;
    white-space: nowrap;
    text-align: center;
  }
  .info.bad {
    color: var(--danger);
  }
  .expand.hidden {
    visibility: hidden;
  }
  .chev {
    display: grid;
    transition: transform 0.15s var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
</style>
