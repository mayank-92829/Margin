<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { findTargets } from "../lib/findTargets";
  import { ipc, type LargeMatch } from "../lib/ipc";
  import { largeInfo } from "../lib/largeInfo.svelte";
  import { settings } from "../lib/settings.svelte";
  import { openLargeInEditor, type Tab } from "../lib/tabs.svelte";
  import { toast } from "../lib/ui.svelte";

  let { tab }: { tab: Tab } = $props();

  const BLOCK = 512;
  const id = $derived(tab.large?.id ?? 0);
  const lineH = $derived(Math.round(settings.fontSize * (settings.zoom / 100) * settings.lineHeight * 10) / 10);

  let total = $state(1);
  let done = $state(false);
  let top = $state(0);
  let height = $state(400);
  let version = $state(0);
  let match: LargeMatch | null = $state(null);
  let error = $state("");

  let viewport: HTMLDivElement | undefined = $state();
  const cache = new Map<number, string[]>();
  const pending = new Set<number>();
  let poll: ReturnType<typeof setInterval> | undefined;

  const visible = $derived(Math.max(1, Math.ceil(height / lineH) + 1));
  const maxTop = $derived(Math.max(0, total - Math.floor(height / lineH) + 1));
  const first = $derived(Math.floor(top));
  const gutterCh = $derived(String(total).length);

  function fetchBlock(b: number) {
    if (pending.has(b) || id === 0) return;
    const have = cache.get(b);
    if (have && (have.length === BLOCK || b * BLOCK + have.length >= total)) return;
    pending.add(b);
    const forId = id;
    ipc
      .largeLines(forId, b * BLOCK, BLOCK)
      .then((lines) => {
        if (forId !== id) return;
        cache.set(b, lines);
        if (cache.size > 64) cache.delete(cache.keys().next().value!);
        version++;
      })
      .catch((e) => (error = String(e)))
      .finally(() => pending.delete(b));
  }

  function lineAt(n: number): string | undefined {
    return cache.get(Math.floor(n / BLOCK))?.[n % BLOCK];
  }

  const rows = $derived.by(() => {
    void version;
    const out: { n: number; text: string | undefined }[] = [];
    const end = Math.min(total, first + visible);
    for (let n = first; n < end; n++) out.push({ n, text: lineAt(n) });
    return out;
  });

  $effect(() => {
    const end = Math.min(total, first + visible + 64);
    for (let b = Math.floor(Math.max(0, first - 64) / BLOCK); b * BLOCK < end; b++) fetchBlock(b);
  });

  function setTop(v: number) {
    top = Math.max(0, Math.min(maxTop, v));
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * visible : e.deltaY / lineH;
    setTop(top + d);
  }

  function onKey(e: KeyboardEvent) {
    const page = Math.max(1, visible - 2);
    const keys: Record<string, () => void> = {
      ArrowDown: () => setTop(first + 1),
      ArrowUp: () => setTop(Math.ceil(top) - 1),
      PageDown: () => setTop(top + page),
      PageUp: () => setTop(top - page),
      Home: () => e.ctrlKey && setTop(0),
      End: () => e.ctrlKey && setTop(maxTop),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    } else if (e.ctrlKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
    }
  }

  // ---- custom scrollbar (native ones can't represent millions of lines precisely)
  const thumbH = $derived(Math.max(28, Math.min(height, (height * visible) / Math.max(total, 1))));
  const thumbY = $derived(maxTop ? ((height - thumbH) * top) / maxTop : 0);
  let grab: number | null = null;

  function thumbDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    grab = e.clientY - thumbY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function thumbMove(e: PointerEvent) {
    if (grab === null || !viewport) return;
    const y = e.clientY - grab;
    setTop((y / Math.max(1, height - thumbH)) * maxTop);
  }
  function trackDown(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTop(((e.clientY - r.top - thumbH / 2) / Math.max(1, height - thumbH)) * maxTop);
  }

  function showMatch(m: LargeMatch | null) {
    match = m;
    if (m) setTop(m.line - Math.floor(visible / 2) + 1);
  }

  function splitMatch(text: string, m: LargeMatch): [string, string, string] {
    const a = Math.min(m.colStart, text.length);
    const b = Math.min(m.colEnd, text.length);
    return [text.slice(0, a), text.slice(a, b), text.slice(b)];
  }

  async function pollStatus() {
    if (!id) return;
    try {
      const s = await ipc.largeStatus(id);
      total = s.lines;
      done = s.done;
      Object.assign(largeInfo, { id, lines: s.lines, done: s.done, progress: s.size ? s.bytesIndexed / s.size : 1 });
      if (s.error) error = s.error;
      if (s.done) {
        clearInterval(poll);
        version++;
      }
    } catch {
      clearInterval(poll);
    }
  }

  onMount(() => {
    findTargets.large = { showMatch, topLine: () => first };
    const ro = new ResizeObserver(() => viewport && (height = viewport.clientHeight));
    if (viewport) ro.observe(viewport);
    return () => ro.disconnect();
  });

  $effect(() => {
    // New file (or reload): reset everything.
    void id;
    cache.clear();
    pending.clear();
    top = 0;
    match = null;
    total = 1;
    done = false;
    error = "";
    clearInterval(poll);
    pollStatus();
    poll = setInterval(pollStatus, 150);
  });

  onDestroy(() => {
    clearInterval(poll);
    findTargets.large = null;
  });

  async function openInEditor() {
    if ((tab.large?.size ?? 0) > 512 * 1024 * 1024) {
      toast("This file is too large to edit in memory.");
      return;
    }
    await openLargeInEditor(tab);
  }
</script>

<div class="large">
  <div class="bar">
    <span>Large file — opened read-only so it loads instantly.</span>
    {#if (tab.large?.size ?? 0) <= 512 * 1024 * 1024}
      <button class="btn small" onclick={openInEditor}>Open in editor</button>
    {/if}
    {#if error}<span class="err">{error}</span>{/if}
  </div>
  <div
    class="viewport"
    bind:this={viewport}
    role="textbox"
    aria-readonly="true"
    aria-multiline="true"
    tabindex="0"
    onwheel={onWheel}
    onkeydown={onKey}
    style="--lh:{lineH}px; --gutter:{gutterCh + 2}ch"
  >
    <div class="gutter" style="transform: translateY({-(top - first) * lineH}px)">
      {#each rows as r (r.n)}<div class="ln" class:hit={match?.line === r.n}>{r.n + 1}</div>{/each}
    </div>
    <div class="hscroll">
      <div class="large-lines" style="transform: translateY({-(top - first) * lineH}px)">
        {#each rows as r (r.n)}
          {#if r.text === undefined}
            <div class="line pending">&nbsp;</div>
          {:else if match && match.line === r.n && match.colStart < 1e15}
            {@const [a, b, c] = splitMatch(r.text, match)}
            <div class="line">{a}<mark>{b}</mark>{c}&#8203;</div>
          {:else}
            <div class="line">{r.text}&#8203;</div>
          {/if}
        {/each}
      </div>
    </div>
    {#if total > visible - 1}
      <div class="track" role="presentation" onpointerdown={trackDown}>
        <div
          class="thumb"
          role="presentation"
          style="height:{thumbH}px; transform: translateY({thumbY}px)"
          onpointerdown={thumbDown}
          onpointermove={thumbMove}
          onpointerup={() => (grab = null)}
        ></div>
      </div>
    {/if}
  </div>
</div>

<style>
  .large {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 14px;
    font-size: 12px;
    color: var(--muted);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .err {
    color: var(--danger);
  }
  .viewport {
    position: relative;
    flex: 1;
    display: flex;
    overflow: hidden;
    outline: none;
    font-family: var(--editor-font);
    font-size: var(--editor-size);
    letter-spacing: var(--editor-ls);
    font-variant-ligatures: var(--editor-lig);
  }
  .gutter {
    flex-shrink: 0;
    width: var(--gutter);
    padding-top: 8px;
    text-align: right;
    color: var(--gutter);
    user-select: none;
  }
  .ln {
    height: var(--lh);
    line-height: var(--lh);
    padding-right: 1ch;
  }
  .ln.hit {
    color: var(--fg);
  }
  .hscroll {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    margin-right: 12px;
  }
  .large-lines {
    padding: 8px 16px 0 10px;
    width: max-content;
    min-width: 100%;
    user-select: text;
    -webkit-user-select: text;
  }
  .line {
    height: var(--lh);
    line-height: var(--lh);
    white-space: pre;
    tab-size: 4;
  }
  .line.pending {
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--fg) 4%, transparent), transparent);
  }
  mark {
    background: var(--match-active);
    color: inherit;
    border-radius: 2px;
  }
  .track {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 12px;
  }
  .thumb {
    width: 6px;
    margin-left: 3px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--fg) 18%, transparent);
  }
  .thumb:hover {
    background: color-mix(in srgb, var(--fg) 32%, transparent);
  }
</style>
