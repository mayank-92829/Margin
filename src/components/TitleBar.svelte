<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { tick } from "svelte";
  import { runCommand, shortcutLabel, commands } from "../lib/commands";
  import { settings } from "../lib/settings.svelte";
  import { build, isRunning, runnerFor, stop } from "../lib/run.svelte";
  import { toggleSidebar } from "../lib/sidebar.svelte";
  import { activate, activeTab, closeTab, closeTabs, moveTab, newTab, reopenClosed, tabsState, type Tab } from "../lib/tabs.svelte";
  import { openMenu, toast, ui, type MenuItem } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";

  const win = getCurrentWindow();
  const current = $derived(activeTab());
  const runner = $derived(current?.kind === "text" ? runnerFor(current.path) : null);
  const running = $derived(isRunning());
  let strip: HTMLDivElement | undefined = $state();
  let drag: { id: string; startX: number; moved: boolean; index: number } | null = null;

  const hint = (id: string) => {
    const c = commands.find((x) => x.id === id);
    return c ? shortcutLabel(c) : undefined;
  };
  const item = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, hint: hint(id), run: () => runCommand(id), ...extra });

  // Scroll the active tab into view when it changes.
  $effect(() => {
    const id = tabsState.activeId;
    tick().then(() => strip?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });

  function down(e: PointerEvent, tab: Tab, i: number) {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
      return;
    }
    if (e.button !== 0) return;
    activate(tab.id);
    drag = { id: tab.id, startX: e.clientX, moved: false, index: i };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag || !strip) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < 6) return;
    drag.moved = true;
    const els = [...strip.querySelectorAll<HTMLElement>(".tab")];
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (i !== drag.index && e.clientX >= r.left && e.clientX < r.right) {
        // Only swap once the pointer passes the middle of the neighbour, so tabs don't jitter.
        const mid = r.left + r.width / 2;
        if ((i > drag.index && e.clientX > mid) || (i < drag.index && e.clientX < mid)) {
          moveTab(drag.index, i);
          drag.index = i;
        }
        break;
      }
    }
  }

  function up() {
    drag = null;
  }

  function tabMenu(e: MouseEvent, tab: Tab) {
    e.preventDefault();
    const list = tabsState.list;
    const i = list.findIndex((t) => t.id === tab.id);
    openMenu(e.clientX, e.clientY, [
      { label: "Close", hint: hint("file.close"), run: () => closeTab(tab.id) },
      { label: "Close others", disabled: list.length < 2, run: () => closeTabs(list.filter((t) => t.id !== tab.id).map((t) => t.id)) },
      { label: "Close to the right", disabled: i >= list.length - 1, run: () => closeTabs(list.slice(i + 1).map((t) => t.id)) },
      { label: "Close saved", run: () => closeTabs(list.filter((t) => !t.dirty).map((t) => t.id)) },
      { separator: true },
      {
        label: "Copy path",
        disabled: !tab.path,
        run: () => navigator.clipboard.writeText(tab.path!).then(() => toast("Path copied", { ms: 1400 })),
      },
      { label: "Reveal in File Explorer", disabled: !tab.path, run: () => revealItemInDir(tab.path!) },
      { separator: true },
      { label: "Reopen closed tab", hint: hint("file.reopenClosed"), run: reopenClosed },
    ]);
  }

  function mainMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(
      r.right,
      r.bottom + 4,
      [
        item("New tab", "file.new"),
        item("Open…", "file.open"),
        item("Open recent…", "file.openRecent"),
        item("Save", "file.save"),
        item("Save as…", "file.saveAs"),
        item("Save all", "file.saveAll"),
        { separator: true },
        item("Open folder…", "file.openFolder"),
        { separator: true },
        item("Find", "edit.find"),
        item("Replace", "edit.replace"),
        item("Go to line…", "edit.gotoLine"),
        { separator: true },
        item("Sidebar", "view.sidebar", { checked: ui.sidebar.open }),
        item("Output panel", "run.output"),
        item("Word wrap", "view.wordWrap", { checked: settings.wordWrap }),
        item("Zen mode", "view.zen"),
        item("Always on top", "view.alwaysOnTop", { checked: ui.alwaysOnTop }),
        { separator: true },
        item("Command palette", "view.palette"),
        item("Theme…", "view.theme"),
        item("Settings", "view.settings"),
        { separator: true },
        item("Print…", "file.print"),
        item("About Margin", "help.about"),
      ],
      "right",
    );
  }

  function wheel(e: WheelEvent) {
    if (!strip || e.ctrlKey) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }
</script>

<header class="titlebar" data-tauri-drag-region>
  <button class="icon-btn side-btn" class:on={ui.sidebar.open} aria-label="Toggle sidebar" title="Sidebar ({hint('view.sidebar')})" onclick={toggleSidebar}>
    <Icon name="sidebar" />
  </button>
  <div class="tabs" bind:this={strip} onwheel={wheel} role="tablist">
    {#each tabsState.list as tab, i (tab.id)}
      <div
        class="tab"
        class:active={tab.id === tabsState.activeId}
        data-id={tab.id}
        role="tab"
        tabindex="-1"
        aria-selected={tab.id === tabsState.activeId}
        title={tab.path ?? tab.title}
        onpointerdown={(e) => down(e, tab, i)}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        onauxclick={(e) => e.button === 1 && e.preventDefault()}
        oncontextmenu={(e) => tabMenu(e, tab)}
      >
        <span class="name">{tab.title}</span>
        <button
          class="close"
          class:dirty={tab.dirty}
          aria-label="Close tab"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
        >
          <span class="dot"></span>
          <span class="x"><Icon name="close" size={12} /></span>
        </button>
      </div>
    {/each}
    <button class="new" aria-label="New tab" title="New tab ({hint('file.new')})" onclick={() => newTab()}><Icon name="plus" size={14} /></button>
    <div class="drag" data-tauri-drag-region></div>
  </div>
  {#if runner}
    <div class="run" role="group" aria-label="Build and run">
      {#if runner.compile}
        <button class="icon-btn" aria-label="Compile" title="Compile ({hint('run.build')})" disabled={running} onclick={() => build(false)}>
          <Icon name="build" />
        </button>
      {/if}
      {#if running}
        <button class="icon-btn stop" aria-label="Stop" title="Stop ({hint('run.stop')})" onclick={stop}><Icon name="stop" size={13} /></button>
      {:else}
        <button class="icon-btn play" aria-label={runner.compile ? "Compile and run" : "Run"} title="{runner.compile ? 'Compile & Run' : 'Run'} ({hint('run.run')})" onclick={() => build(true)}>
          <Icon name="play" size={14} />
        </button>
      {/if}
    </div>
  {/if}
  <button class="icon-btn menu-btn" aria-label="Menu" title="Menu" onclick={mainMenu}><Icon name="more" /></button>
  <div class="controls">
    <button class="wc" aria-label="Minimize" onclick={() => win.minimize()}>&#xE921;</button>
    <button class="wc" aria-label={ui.maximized ? "Restore" : "Maximize"} onclick={() => win.toggleMaximize()}>
      {@html ui.maximized ? "&#xE923;" : "&#xE922;"}
    </button>
    <button class="wc close-win" aria-label="Close" onclick={() => win.close()}>&#xE8BB;</button>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: stretch;
    height: 40px;
    flex-shrink: 0;
    background: var(--surface);
  }
  .tabs {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
    padding: 0 6px 0 8px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 1 200px;
    min-width: 72px;
    height: 32px;
    padding: 0 4px 0 12px;
    border-radius: 8px 8px 0 0;
    color: var(--muted);
    font-size: 12.5px;
    transition: background 0.12s, color 0.12s;
  }
  .tab:hover {
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
    color: var(--fg);
  }
  .tab.active {
    background: var(--bg);
    color: var(--fg);
  }
  /* Soft separators between inactive tabs, like Windows 11. */
  .tab:not(.active):not(:hover) + .tab:not(.active):not(:hover)::before {
    content: "";
    position: absolute;
    left: -1px;
    top: 9px;
    bottom: 9px;
    width: 1px;
    background: var(--border);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    position: relative;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 5px;
    color: var(--muted);
  }
  .close:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .close .x {
    display: grid;
    opacity: 0;
  }
  .tab:hover .close .x,
  .tab.active .close:not(.dirty) .x,
  .close:hover .x {
    opacity: 1;
  }
  .dot {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg);
    opacity: 0;
  }
  .close.dirty .dot {
    opacity: 0.75;
  }
  .close.dirty:hover .dot,
  .tab:hover .close.dirty .dot {
    opacity: 0;
  }
  .new {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin: 0 0 2px 2px;
    flex-shrink: 0;
    border-radius: 6px;
    color: var(--muted);
  }
  .new:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .drag {
    flex: 1;
    min-width: 24px;
    align-self: stretch;
  }
  .menu-btn {
    align-self: center;
    margin-right: 4px;
  }
  .side-btn {
    align-self: center;
    margin-left: 6px;
    flex-shrink: 0;
  }
  .side-btn.on {
    background: none;
  }
  .run {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: 6px;
    padding-right: 6px;
    border-right: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    align-self: center;
  }
  .run .icon-btn:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .run .play {
    color: var(--tk-string);
  }
  .run .stop {
    color: var(--danger);
  }
  .controls {
    display: flex;
  }
  .wc {
    width: 46px;
    height: 40px;
    font-family: "Segoe Fluent Icons", "Segoe MDL2 Assets";
    font-size: 10px;
    color: var(--fg);
    transition: background 0.1s;
  }
  .wc:hover {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }
  .close-win:hover {
    background: #c42b1c;
    color: #fff;
  }
</style>
