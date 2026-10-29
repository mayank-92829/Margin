<script lang="ts">
  import { encodingMenu, gotoLine, pickEol, pickIndent, pickLanguage } from "../lib/commands";
  import { encodingLabel } from "../lib/encodings";
  import { setSetting, settings, settingsFor } from "../lib/settings.svelte";
  import { activeTab, allowEditing, isMarkdown, setViewMode, status } from "../lib/tabs.svelte";
  import { largeInfo } from "../lib/largeInfo.svelte";
  import Icon from "./Icon.svelte";

  const tab = $derived(activeTab());
  const md = $derived(isMarkdown(tab));
  const fs = $derived(tab ? settingsFor(tab.path, md ? "markdown" : "other") : null);
  const indent = $derived(tab?.indent ?? (fs ? { spaces: fs.insertSpaces, size: fs.tabSize } : null));

  function size(bytes: number): string {
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${i ? n.toFixed(n < 10 ? 1 : 0) : n} ${units[i]}`;
  }
</script>

<footer class="statusbar">
  {#if tab && tab.loaded && tab.kind === "text"}
    <button class="item" title="Go to line (Ctrl+G)" onclick={gotoLine}>
      Ln {status.line.toLocaleString()}, Col {status.col.toLocaleString()}
      {#if status.selected}<span class="dim">({status.selected.toLocaleString()} selected)</span>{/if}
    </button>
    {#if status.cursors > 1}<span class="item static">{status.cursors} cursors</span>{/if}
    {#if settings.showWordCount && status.words >= 0}
      <span class="item static">
        {status.selWords ? `${status.selWords.toLocaleString()} of ` : ""}{status.words.toLocaleString()} word{status.words === 1 ? "" : "s"}
      </span>
    {/if}
  {:else if tab && tab.kind === "large"}
    <span class="item static">
      {largeInfo.lines.toLocaleString()} lines{largeInfo.done ? "" : "…"} · {size(tab.large?.size ?? 0)}
    </span>
    {#if !largeInfo.done}<span class="item static dim">Indexing {Math.round(largeInfo.progress * 100)}%</span>{/if}
  {/if}

  <span class="spacer"></span>

  {#if tab && tab.loaded}
    {#if tab.readOnly}
      <button class="item badge" title="Click to allow editing" onclick={() => tab.kind === "text" && allowEditing(tab)}>Read-only</button>
    {/if}
    {#if settings.zoom !== 100}
      <button class="item" title="Reset zoom (Ctrl+0)" onclick={() => setSetting("zoom", 100)}>{settings.zoom}%</button>
    {/if}
    {#if md && tab.kind === "text"}
      <div class="modes" role="group" aria-label="Markdown view">
        <button class:on={tab.viewMode === "source"} title="Source" aria-label="Source" onclick={() => setViewMode(tab, "source")}><Icon name="code" size={14} /></button>
        <button class:on={tab.viewMode === "split"} title="Side by side (Ctrl+Shift+E)" aria-label="Side by side" onclick={() => setViewMode(tab, "split")}><Icon name="split" size={14} /></button>
        <button class:on={tab.viewMode === "preview"} title="Preview (Ctrl+E)" aria-label="Preview" onclick={() => setViewMode(tab, "preview")}><Icon name="eye" size={14} /></button>
      </div>
    {/if}
    {#if tab.kind === "text"}
      <button class="item" title="Language mode" onclick={pickLanguage}>{tab.language ?? "Plain Text"}</button>
      {#if indent}
        <button class="item" title="Indentation" onclick={pickIndent}>{indent.spaces ? `Spaces: ${indent.size}` : `Tabs: ${indent.size || 4}`}</button>
      {/if}
    {/if}
    <button class="item" title="Encoding" onclick={encodingMenu}>{encodingLabel(tab.encoding, tab.bom)}</button>
    {#if tab.kind === "text"}
      <button class="item eol" title="Line endings" onclick={pickEol}>{tab.eol}</button>
    {/if}
  {/if}
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    height: 26px;
    flex-shrink: 0;
    padding: 0 8px;
    gap: 2px;
    font-size: 12px;
    color: var(--faint);
    background: var(--bg);
    border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    overflow: hidden;
    white-space: nowrap;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
  }
  button.item:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .dim {
    opacity: 0.75;
  }
  .badge {
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .modes {
    display: flex;
    gap: 1px;
    margin: 0 4px;
    padding: 1px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface-2) 60%, transparent);
  }
  .modes button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 18px;
    border-radius: 5px;
    color: var(--faint);
  }
  .modes button:hover {
    color: var(--fg);
  }
  .modes button.on {
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
</style>
