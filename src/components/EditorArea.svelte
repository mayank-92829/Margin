<script lang="ts">
  import { EditorView } from "@codemirror/view";
  import { onMount } from "svelte";
  import { pickEncoding } from "../lib/commands";
  import { setView } from "../lib/editor/instance";
  import { createEditorState } from "../lib/editor/view";
  import {
    activeTab,
    allowEditing,
    editorConfigFor,
    isMarkdown,
    keepMine,
    mountActive,
    reloadTab,
    saveTab,
    type Tab,
  } from "../lib/tabs.svelte";
  import { ui } from "../lib/ui.svelte";
  import FindBar from "./FindBar.svelte";
  import Icon from "./Icon.svelte";
  import LargeViewer from "./LargeViewer.svelte";
  import Preview from "./Preview.svelte";
  import RunPanel from "./RunPanel.svelte";

  let { findBar = $bindable() }: { findBar?: FindBar } = $props();

  let host: HTMLDivElement | undefined = $state();
  let area: HTMLDivElement | undefined = $state();

  const tab = $derived(activeTab());
  const isText = $derived(!!tab && tab.kind === "text" && tab.loaded);
  const md = $derived(isText && isMarkdown(tab));
  const mode = $derived(md ? tab!.viewMode : "source");
  const showLoading = $derived(!!tab && tab.loading);

  onMount(() => {
    const blank = { path: null, readOnly: false, indent: null, language: null } as unknown as Tab;
    const view = new EditorView({ parent: host!, state: createEditorState("", editorConfigFor(blank), []) });
    setView(view);
    mountActive();
    return () => {
      setView(null);
      view.destroy();
    };
  });

  function startResize(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!area) return;
      const r = area.getBoundingClientRect();
      ui.splitRatio = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left) / r.width));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

<div class="area" bind:this={area}>
  {#if tab && tab.loaded && tab.kind === "text"}
    {#if tab.external === "modified"}
      <div class="banner">
        <Icon name="warn" size={14} />
        <span>This file was changed by another program.</span>
        <button class="btn small" onclick={() => reloadTab(tab)}>Reload</button>
        <button class="btn small" onclick={() => keepMine(tab)}>Keep my version</button>
      </div>
    {:else if tab.external === "deleted"}
      <div class="banner">
        <Icon name="warn" size={14} />
        <span>This file was deleted or moved. Your text is still here.</span>
        <button class="btn small" onclick={() => saveTab(tab)}>Save again</button>
        <button class="btn small" onclick={() => saveTab(tab, true)}>Save as…</button>
      </div>
    {:else if tab.binary && tab.readOnly}
      <div class="banner">
        <Icon name="info" size={14} />
        <span>This looks like a binary file, so it opened read-only.</span>
        <button class="btn small" onclick={() => allowEditing(tab)}>Edit anyway</button>
      </div>
    {:else if tab.lossy}
      <div class="banner">
        <Icon name="info" size={14} />
        <span>Some characters couldn't be read as {tab.encoding}.</span>
        <button class="btn small" onclick={() => pickEncoding("reopen")}>Reopen with encoding…</button>
        <button class="btn small" onclick={() => tab && (tab.lossy = false)}>Dismiss</button>
      </div>
    {/if}
  {/if}

  <div class="panes" class:split={mode === "split"} style="--ratio:{ui.splitRatio}">
    <div class="source" class:hidden={!isText || mode === "preview"} bind:this={host}></div>
    {#if md && mode !== "source"}
      {#if mode === "split"}
        <div class="divider" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>
      {/if}
      <div class="preview-pane">
        <Preview tab={tab!} mode={mode} />
      </div>
    {/if}
    {#if tab && tab.kind === "large" && tab.large}
      {#key tab.id}
        <LargeViewer {tab} />
      {/key}
    {/if}
    {#if showLoading}
      <div class="loading"><span class="spinner"></span></div>
    {/if}
    <FindBar bind:this={findBar} />
  </div>
  <RunPanel />
</div>

<style>
  .area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--fg);
  }
  .banner span {
    flex: 1;
  }
  .panes {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .source {
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .source.hidden {
    display: none;
  }
  .split .source {
    flex: 0 0 calc(var(--ratio) * 100%);
  }
  .preview-pane {
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .divider {
    flex: 0 0 5px;
    margin: 0 -2px;
    z-index: 2;
    cursor: col-resize;
    background: linear-gradient(to right, transparent 2px, var(--border) 2px, var(--border) 3px, transparent 3px);
  }
  .divider:hover {
    background: linear-gradient(to right, transparent 1px, var(--accent) 1px, var(--accent) 4px, transparent 4px);
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--bg);
    animation: appear 0.3s ease 0.15s both;
  }
  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
