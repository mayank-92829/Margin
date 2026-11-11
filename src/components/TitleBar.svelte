<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { tick } from "svelte";
  import { runCommand, shortcutLabel, commands, pickLanguage } from "../lib/commands";
  import { IS_WINDOWS } from "../lib/platform";
  import { settings } from "../lib/settings.svelte";
  import { build, isRunning, run, runnerFor, stop } from "../lib/run.svelte";
  import { toggleSidebar } from "../lib/sidebar.svelte";
  import { activate, activeTab, closeTab, closeTabs, moveTab, newTab, reopenClosed, setLanguage, tabsState, type Tab } from "../lib/tabs.svelte";
  import { detectLanguage } from "../lib/editor/languages";
  import { openMenu, toast, ui, type MenuItem } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";

  const win = getCurrentWindow();
  const current = $derived(activeTab());
  const showRun = $derived(settings.runButtons === "always" || (settings.runButtons === "auto" && run.used));
  const runner = $derived(showRun && current?.kind === "text" ? runnerFor(current.path, current.language) : null);
  const running = $derived(isRunning());
  let strip: HTMLDivElement | undefined = $state();
  let drag: { id: string; startX: number; moved: boolean; index: number } | null = null;
  let renamingTabId: string | null = $state(null);
  let renameValue = $state("");
  let renameInput: HTMLInputElement | undefined = $state();

  function startRename(tab: Tab) {
    if (tab.path) return;
    renamingTabId = tab.id;
    renameValue = tab.title;
    tick().then(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  }

  function commitRename(tab: Tab) {
    if (renamingTabId !== tab.id) return;
    const val = renameValue.trim();
    renamingTabId = null;
    if (!val || val === tab.title) return;
    tab.title = val;
    const detected = detectLanguage(val);
    if (detected) {
      setLanguage(tab, detected.name, false);
    }
  }

  function onRenameKey(e: KeyboardEvent, tab: Tab) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(tab);
    } else if (e.key === "Escape") {
      e.preventDefault();
      renamingTabId = null;
    }
  }

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
      ...(!tab.path ? [{ label: "Rename…", run: () => startRename(tab) }, { separator: true }] : []),
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

  function typeMenu(e: MouseEvent) {
    if (!current || current.kind !== "text") return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tab = current;
    const common = [
      { label: "Plain Text", lang: null },
      { label: "C", lang: "C" },
      { label: "C++", lang: "C++" },
      { label: "Rust", lang: "Rust" },
      { label: "Python", lang: "Python" },
      { label: "Markdown", lang: "Markdown" },
      { label: "JavaScript", lang: "JavaScript" },
      { label: "TypeScript", lang: "TypeScript" },
      { label: "HTML", lang: "HTML" },
      { label: "CSS", lang: "CSS" },
      { label: "JSON", lang: "JSON" },
      { label: "Go", lang: "Go" },
      { label: "Java", lang: "Java" },
    ];
    openMenu(
      r.left,
      r.bottom + 4,
      [
        ...common.map((c) => ({
          label: c.label,
          checked: tab.language === c.lang || (!tab.language && c.lang === null && !tab.languageAuto),
          run: () => setLanguage(tab, c.lang, false),
        })),
        { separator: true },
        {
          label: "More languages…",
          hint: hint("view.language"),
          run: () => pickLanguage(),
        },
        ...(tab.path
          ? [
              {
                label: "Auto Detect",
                checked: tab.languageAuto,
                run: () => setLanguage(tab, detectLanguage(tab.path)?.name ?? null, true),
              },
            ]
          : []),
      ]
    );
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
        ...(current?.kind === "text" && runnerFor(current.path, current.language) ? [item("Compile & run", "run.run"), item("Compile", "run.build")] : []),
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
  {#if ui.sidebar.open}
    <button class="icon-btn side-btn" aria-label="Hide sidebar" title="Hide sidebar ({hint('view.sidebar')})" onclick={toggleSidebar}>
      <Icon name="sidebar" />
    </button>
  {/if}
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
        ondblclick={(e) => { if (!tab.path) { e.stopPropagation(); startRename(tab); } }}
      >
        {#if renamingTabId === tab.id}
          <input
            class="tab-rename"
            bind:this={renameInput}
            bind:value={renameValue}
            onpointerdown={(e) => e.stopPropagation()}
            onkeydown={(e) => onRenameKey(e, tab)}
            onblur={() => commitRename(tab)}
          />
        {:else}
          <span class="name">{tab.title}</span>
        {/if}
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
  {#if current && current.kind === "text"}
    <button
      class="type-btn"
      aria-label="Select file type"
      title="File type: {current.language ?? 'Plain Text'} (click to change)"
      onclick={typeMenu}
    >
      <span class="type-label">{current.language ?? "Plain Text"}</span>
      <Icon name="down" size={10} />
    </button>
  {/if}
  <button class="icon-btn menu-btn" aria-label="Menu" title="Menu" onclick={mainMenu}><Icon name="more" /></button>
  <!-- Linux desktops draw their own title bar with these buttons. -->
  {#if IS_WINDOWS}
    <div class="controls">
      <button class="wc" aria-label="Minimize" onclick={() => win.minimize()}>&#xE921;</button>
      <button class="wc" aria-label={ui.maximized ? "Restore" : "Maximize"} onclick={() => win.toggleMaximize()}>
        {@html ui.maximized ? "&#xE923;" : "&#xE922;"}
      </button>
      <button class="wc close-win" aria-label="Close" onclick={() => win.close()}>&#xE8BB;</button>
    </div>
  {/if}
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
  .tab-rename {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 4px;
    background: var(--surface-2);
    color: var(--fg);
    border: 1px solid var(--accent);
    border-radius: 4px;
    font-size: 12px;
    outline: none;
    margin-right: 2px;
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
  .type-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    margin-right: 4px;
    align-self: center;
    border-radius: 6px;
    font-size: 11.5px;
    color: var(--muted);
    background: transparent;
    transition: background 0.12s, color 0.12s;
    user-select: none;
    max-width: 140px;
    flex-shrink: 0;
  }
  .type-btn:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .type-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side-btn {
    align-self: center;
    margin-left: 6px;
    flex-shrink: 0;
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
