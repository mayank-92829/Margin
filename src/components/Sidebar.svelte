<script lang="ts">
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { tick, untrack } from "svelte";
  import { basename, samePath } from "../lib/path";
  import { activePath, collapseAll, joinPath, newFileIn, openFolderDialog, refreshTree, reveal, setFolder, toggleDir, tree } from "../lib/sidebar.svelte";
  import { openFile, scheduleSession } from "../lib/tabs.svelte";
  import { openMenu, toast, ui } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";

  interface Row {
    path: string;
    name: string;
    dir: boolean;
    depth: number;
  }

  let resizing = $state(false);

  const folder = $derived(ui.sidebar.folder);
  const current = $derived(activePath());

  const rows: Row[] = $derived.by(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of tree.children[dir] ?? []) {
        const path = joinPath(dir, e.name);
        out.push({ path, name: e.name, dir: e.dir, depth });
        if (e.dir && ui.sidebar.expanded[path]) walk(path, depth + 1);
      }
    };
    if (folder) walk(folder, 0);
    return out;
  });

  // Read the folder (and the folders left expanded last time) when it's first shown.
  $effect(() => {
    if (ui.sidebar.open && folder) untrack(() => !tree.children[folder] && refreshTree());
  });

  let treeEl: HTMLDivElement | undefined = $state();

  // Follow the file being edited: open its folders and scroll it into view.
  $effect(() => {
    const p = current;
    if (!p || !folder || !ui.sidebar.open) return;
    untrack(() =>
      reveal(p)
        .then(tick)
        .then(() => treeEl?.querySelector(".row.active")?.scrollIntoView({ block: "nearest" })),
    );
  });

  function rowClick(r: Row) {
    if (r.dir) toggleDir(r.path);
    else openFile(r.path);
  }

  function copyPath(p: string) {
    navigator.clipboard.writeText(p).then(() => toast("Path copied", { ms: 1400 }));
  }

  function rowMenu(e: MouseEvent, r: Row) {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      r.dir ? { label: ui.sidebar.expanded[r.path] ? "Collapse" : "Expand", run: () => toggleDir(r.path) } : { label: "Open", run: () => openFile(r.path) },
      ...(r.dir ? [{ label: "New file here…", run: () => newFileIn(r.path) }, { label: "Open as folder", run: () => setFolder(r.path) }] : []),
      { separator: true },
      { label: "Copy path", run: () => copyPath(r.path) },
      { label: "Reveal in File Explorer", run: () => revealItemInDir(r.path) },
    ]);
  }

  function folderMenu(e: MouseEvent) {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!folder) return;
    openMenu(b.left, b.bottom + 4, [
      { label: "New file…", run: () => newFileIn(folder) },
      { label: "Refresh", run: refreshTree },
      { label: "Collapse all", run: collapseAll },
      { separator: true },
      { label: "Open another folder…", run: openFolderDialog },
      { label: "Copy path", run: () => copyPath(folder) },
      { label: "Reveal in File Explorer", run: () => revealItemInDir(folder) },
      { separator: true },
      { label: "Close folder", run: () => setFolder(null) },
    ]);
  }

  function startResize(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    resizing = true;
    const startX = e.clientX;
    const startW = ui.sidebar.width;
    const move = (ev: PointerEvent) => (ui.sidebar.width = Math.round(Math.min(600, Math.max(160, startW + ev.clientX - startX))));
    const up = () => {
      resizing = false;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      scheduleSession();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

<aside class="sidebar" class:open={ui.sidebar.open} class:resizing style="--w:{ui.sidebar.width}px" aria-label="Files" aria-hidden={!ui.sidebar.open}>
  <div class="inner">
    {#if folder}
      <header>
        <button class="title" title={folder} onclick={folderMenu}>
          <span>{basename(folder)}</span>
          <Icon name="down" size={12} />
        </button>
        <button class="icon-btn" title="New file" aria-label="New file" onclick={() => newFileIn(folder)}><Icon name="plus" size={14} /></button>
        <button class="icon-btn" title="Refresh" aria-label="Refresh" onclick={refreshTree}><Icon name="refresh" size={14} /></button>
        <button class="icon-btn" title="Collapse all" aria-label="Collapse all" onclick={collapseAll}><Icon name="collapse" size={14} /></button>
      </header>
      <div class="tree" role="tree" bind:this={treeEl}>
        {#each rows as r (r.path)}
          <button
            class="row"
            class:dir={r.dir}
            class:active={!r.dir && !!current && samePath(current, r.path)}
            class:dim={r.name.startsWith(".")}
            style="--depth:{r.depth}"
            role="treeitem"
            aria-selected={!r.dir && !!current && samePath(current, r.path)}
            aria-expanded={r.dir ? !!ui.sidebar.expanded[r.path] : undefined}
            title={r.path}
            onclick={() => rowClick(r)}
            oncontextmenu={(e) => rowMenu(e, r)}
          >
            {#if r.dir}
              <span class="chev" class:open={ui.sidebar.expanded[r.path]}><Icon name="right" size={12} /></span>
            {:else}
              <span class="chev"></span>
            {/if}
            <span class="name">{r.name}</span>
          </button>
        {:else}
          {#if tree.errors[folder]}
            <p class="note">{tree.errors[folder]}</p>
          {:else if tree.children[folder]}
            <p class="note">This folder is empty.</p>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="empty">
        <p>No folder open</p>
        <button class="btn small" onclick={openFolderDialog}>Open folder…</button>
        <kbd>Ctrl+Shift+O</kbd>
      </div>
    {/if}
  </div>
  {#if ui.sidebar.open}
    <div class="resizer" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    flex-shrink: 0;
    width: 0;
    overflow: hidden;
    background: var(--surface);
    transition: width 0.18s var(--ease);
  }
  .sidebar.open {
    width: var(--w);
    max-width: 45vw;
    overflow: visible;
    border-right: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .sidebar.resizing {
    transition: none;
  }
  .inner {
    display: flex;
    flex-direction: column;
    width: var(--w);
    height: 100%;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 34px;
    padding: 0 6px 0 8px;
    flex-shrink: 0;
  }
  header .icon-btn {
    width: 24px;
    height: 24px;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 6px;
    border-radius: 5px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 6px 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
    height: 24px;
    padding: 0 6px 0 calc(var(--depth) * 12px + 2px);
    border-radius: 5px;
    color: var(--muted);
    font-size: 12.5px;
    text-align: left;
  }
  .row:hover {
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
    color: var(--fg);
  }
  .row.active {
    background: var(--surface-2);
    color: var(--fg);
  }
  .row.dir {
    color: var(--fg);
  }
  .row.dim {
    opacity: 0.6;
  }
  .chev {
    display: grid;
    place-items: center;
    width: 16px;
    flex-shrink: 0;
    color: var(--faint);
    transition: transform 0.12s var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin: 8px 10px;
    color: var(--faint);
    font-size: 12px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 16px;
    color: var(--faint);
    font-size: 12.5px;
  }
  .empty p {
    margin: 0;
  }
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -3px;
    width: 6px;
    cursor: col-resize;
    z-index: 3;
  }
  .resizer:hover {
    background: linear-gradient(to right, transparent 2px, var(--accent) 2px, var(--accent) 4px, transparent 4px);
  }
</style>
