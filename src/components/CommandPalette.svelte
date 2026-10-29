<script lang="ts">
  import { tick } from "svelte";
  import { ui, type PaletteItem } from "../lib/ui.svelte";

  let query = $state("");
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();

  interface Scored {
    item: PaletteItem;
    score: number;
    hits: number[];
  }

  function fuzzy(label: string, q: string): { score: number; hits: number[] } | null {
    const l = label.toLowerCase();
    const s = q.toLowerCase().trim();
    if (!s) return { score: 0, hits: [] };
    const at = l.indexOf(s);
    if (at >= 0) {
      const wordStart = at === 0 || /[\s\-_./(]/.test(l[at - 1]);
      return { score: 1000 - at + (wordStart ? 300 : 0) - l.length * 0.1, hits: Array.from({ length: s.length }, (_, i) => at + i) };
    }
    const hits: number[] = [];
    let from = 0;
    let score = 0;
    let prev = -2;
    for (const ch of s) {
      if (ch === " ") continue;
      const i = l.indexOf(ch, from);
      if (i < 0) return null;
      score += i === prev + 1 ? 12 : i === 0 || /[\s\-_./(]/.test(l[i - 1]) ? 9 : 1;
      hits.push(i);
      prev = i;
      from = i + 1;
    }
    return { score, hits };
  }

  const results: Scored[] = $derived.by(() => {
    const p = ui.palette;
    if (!p) return [];
    if (typeof p.items === "function") return p.items(query).map((item) => ({ item, score: 0, hits: [] }));
    const out: Scored[] = [];
    for (const item of p.items) {
      const m = fuzzy(item.label, query);
      if (m) out.push({ item, ...m });
      else if (item.detail) {
        const d = fuzzy(item.detail, query);
        if (d) out.push({ item, score: d.score * 0.3, hits: [] });
      }
    }
    if (query.trim()) out.sort((a, b) => b.score - a.score);
    return out.slice(0, 300);
  });

  let lastConfig: unknown = null;
  $effect(() => {
    const p = ui.palette;
    if (p && p !== lastConfig) {
      lastConfig = p;
      query = p.initialQuery ?? "";
      const items = typeof p.items === "function" ? [] : p.items;
      const cur = items.findIndex((i) => i.current);
      index = query ? 0 : Math.max(0, cur);
      tick().then(() => {
        input?.focus();
        input?.select();
        scrollToIndex();
      });
    } else if (!p) {
      lastConfig = null;
    }
  });

  $effect(() => {
    // Keep the highlighted row valid as results change, and tell the caller (live theme preview).
    const r = results;
    if (index >= r.length) index = Math.max(0, r.length - 1);
    ui.palette?.onHighlight?.(r[index]?.item ?? null);
  });

  function scrollToIndex() {
    list?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function close(cancelled: boolean) {
    const p = ui.palette;
    ui.palette = null;
    if (cancelled) p?.onCancel?.();
  }

  function choose(i: number) {
    const p = ui.palette;
    const r = results[i];
    if (!p || !r || (!r.item.id && typeof p.items === "function")) return;
    ui.palette = null;
    p.onSelect(r.item, query);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      index = Math.min(results.length - 1, index + 1);
      tick().then(scrollToIndex);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      index = Math.max(0, index - 1);
      tick().then(scrollToIndex);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      index = Math.min(results.length - 1, index + 10);
      tick().then(scrollToIndex);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      index = Math.max(0, index - 10);
      tick().then(scrollToIndex);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  function parts(label: string, hits: number[]): { text: string; hit: boolean }[] {
    if (!hits.length) return [{ text: label, hit: false }];
    const set = new Set(hits);
    const out: { text: string; hit: boolean }[] = [];
    for (let i = 0; i < label.length; i++) {
      const hit = set.has(i);
      if (out.length && out[out.length - 1].hit === hit) out[out.length - 1].text += label[i];
      else out.push({ text: label[i], hit });
    }
    return out;
  }
</script>

{#if ui.palette}
  <div class="backdrop" role="presentation" onmousedown={() => close(true)}></div>
  <div class="palette" role="dialog" aria-label="Command palette">
    <input
      bind:this={input}
      bind:value={query}
      class="query"
      placeholder={ui.palette.placeholder}
      spellcheck="false"
      autocomplete="off"
      onkeydown={onKey}
      oninput={() => (index = 0)}
    />
    <div class="list" bind:this={list} role="listbox">
      {#each results as r, i (r.item.id + "\u0000" + i)}
        <button
          class="row"
          class:active={i === index}
          data-i={i}
          role="option"
          aria-selected={i === index}
          onmousemove={() => {
            if (index !== i) index = i;
          }}
          onclick={() => choose(i)}
        >
          <span class="label">
            {#each parts(r.item.label, r.hits) as p}{#if p.hit}<b>{p.text}</b>{:else}{p.text}{/if}{/each}
          </span>
          {#if r.item.current}<span class="dot" title="Current"></span>{/if}
          {#if r.item.detail}<span class="detail">{r.item.detail}</span>{/if}
          {#if r.item.hint}<kbd>{r.item.hint}</kbd>{/if}
        </button>
      {:else}
        <div class="empty">{ui.palette.emptyText ?? "No matches"}</div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .palette {
    position: fixed;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    width: min(620px, calc(100vw - 32px));
    z-index: 31;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: pop 0.14s var(--ease);
  }
  .query {
    width: 100%;
    height: 46px;
    padding: 0 16px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    outline: none;
    font-size: 14px;
  }
  .query::placeholder {
    color: var(--faint);
  }
  .list {
    max-height: min(420px, 60vh);
    overflow-y: auto;
    padding: 5px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border-radius: 7px;
    text-align: left;
  }
  .row.active {
    background: var(--surface-2);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label b {
    color: var(--accent);
    font-weight: 600;
  }
  .detail {
    color: var(--faint);
    font-size: 12px;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .empty {
    padding: 14px 12px;
    color: var(--faint);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
  }
</style>
