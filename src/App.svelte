<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount, untrack } from "svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import Dialog from "./components/Dialog.svelte";
  import EditorArea from "./components/EditorArea.svelte";
  import type FindBar from "./components/FindBar.svelte";
  import Menu from "./components/Menu.svelte";
  import Settings from "./components/Settings.svelte";
  import StatusBar from "./components/StatusBar.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import Toasts from "./components/Toasts.svelte";
  import { boot } from "./lib/boot";
  import { commandForCombo, comboFromEvent, exitZen, runCommand } from "./lib/commands";
  import { getView } from "./lib/editor/instance";
  import { ipc, parseError } from "./lib/ipc";
  import { PER_FILE_KEYS, settings, settingsFor, settingsMeta } from "./lib/settings.svelte";
  import {
    activeTab,
    autoSaveOnBlur,
    checkExternalChanges,
    isMarkdown,
    newTab,
    openPaths,
    prepareExit,
    restoreSession,
    syncConfig,
    tabsState,
  } from "./lib/tabs.svelte";
  import { anyOverlayOpen, ask, toast, ui } from "./lib/ui.svelte";

  const win = getCurrentWindow();
  let findBar: FindBar | undefined = $state();
  const tab = $derived(activeTab());

  // ---- editor appearance (CSS variables, so changes never rebuild the editor)
  $effect(() => {
    const fs = settingsFor(tab?.path ?? null, isMarkdown(tab) ? "markdown" : "other");
    const root = document.documentElement.style;
    const family = fs.fontFamily === "JetBrains Mono" ? "JetBrains Mono Variable" : fs.fontFamily;
    root.setProperty("--editor-font", `"${family.replace(/"/g, "")}", var(--mono-font)`);
    root.setProperty("--editor-size", `${(fs.fontSize * settings.zoom) / 100}px`);
    root.setProperty("--editor-lh", String(fs.lineHeight));
    root.setProperty("--editor-ls", `${fs.letterSpacing}px`);
    root.setProperty("--editor-lig", fs.ligatures ? "normal" : "none");
    root.setProperty("--editor-features", fs.ligatures ? "normal" : '"calt" 0, "liga" 0');
    root.setProperty("--text-width", fs.textWidth ? `calc(${fs.textWidth}ch + 56px)` : ui.zen ? "calc(72ch + 56px)" : "none");
    const pf = { sans: "var(--ui-font)", serif: 'Georgia, "Sitka Text", Cambria, serif', mono: "var(--mono-font)" }[settings.previewFont];
    root.setProperty("--preview-font", pf);
    root.setProperty("--preview-size", `${(settings.previewFontSize * settings.zoom) / 100}px`);
    root.setProperty("--preview-width", `${settings.previewWidth}px`);
    const d = document.documentElement.dataset;
    d.cursor = settings.cursorStyle;
    d.reduceMotion = String(settings.reduceMotion);
    requestAnimationFrame(() => getView()?.requestMeasure());
  });

  // ---- editor behaviour settings → reconfigure the editor
  $effect(() => {
    for (const k of PER_FILE_KEYS) void settings[k];
    void [JSON.stringify(settings.overrides), settings.keymap, settings.cursorBlink, tab?.id, tab?.readOnly];
    untrack(() => syncConfig());
  });

  // ---- window title (taskbar)
  $effect(() => {
    const title = tab ? `${tab.dirty ? "● " : ""}${tab.title} – Margin` : "Margin";
    document.title = title;
    win.setTitle(title).catch(() => {});
  });

  // ---- focus the editor after switching tabs
  $effect(() => {
    void tabsState.activeId;
    void tab?.loaded;
    requestAnimationFrame(() => {
      const t = activeTab();
      const el = document.activeElement;
      if (anyOverlayOpen() || (el instanceof HTMLInputElement && el.closest(".findbar"))) return;
      if (t?.kind === "text" && !(isMarkdown(t) && t.viewMode === "preview")) getView()?.focus();
      else (document.querySelector(".preview, .large .viewport") as HTMLElement | null)?.focus();
    });
  });

  // ---- keyboard
  const BROWSER_KEYS = new Set([
    "F5", "Ctrl+R", "Ctrl+Shift+R", "F7", "Ctrl+U", "Ctrl+J", "Ctrl+Shift+J", "Ctrl+Shift+I", "Ctrl+Shift+C",
    "F12", "Ctrl+Shift+Delete", "Alt+ArrowLeft", "Alt+ArrowRight", "BrowserBack", "BrowserForward", "Ctrl+D", "Ctrl+Shift+O",
    "Ctrl+Shift+B", "Ctrl+H", "Ctrl+P", "Ctrl+S", "Ctrl+F", "Ctrl+G", "Ctrl+Shift+A", "F3", "Shift+F3",
  ]);

  function onKeyCapture(e: KeyboardEvent) {
    if (e.isComposing || ui.dialog) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    if (combo === "Escape") {
      if (ui.menu || ui.palette || ui.settingsOpen) return;
      if (ui.find.open) {
        e.preventDefault();
        findBar?.close();
      } else if (ui.zen) {
        e.preventDefault();
        exitZen();
      }
      return;
    }
    const id = commandForCombo(combo);
    if (!id) return;
    if (ui.palette && id !== "view.palette") return;
    if (ui.settingsOpen && id !== "view.settings" && id !== "view.palette") return;
    if (ui.menu) ui.menu = null;
    e.preventDefault();
    e.stopPropagation();
    if (id === "view.settings" && ui.settingsOpen) ui.settingsOpen = false;
    else runCommand(id);
  }

  // After the editor has had its chance, stop the WebView from doing browser things (reload, back…).
  function onKeyBubble(e: KeyboardEvent) {
    if (!e.defaultPrevented && BROWSER_KEYS.has(comboFromEvent(e))) e.preventDefault();
  }

  // ---- Ctrl+wheel zoom
  let wheelAcc = 0;
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 60) return;
    runCommand(wheelAcc < 0 ? "view.zoomIn" : "view.zoomOut");
    wheelAcc = 0;
  }

  // Native context menus only where they help (editing, copying, spelling).
  function onContextMenu(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest(".cm-content, input, textarea")) return;
    if (t.closest(".preview-body, .large-lines") && String(window.getSelection() ?? "").length) return;
    e.preventDefault();
  }

  let closing = false;

  onMount(() => {
    const unlisten: Promise<() => void>[] = [];
    window.addEventListener("keydown", onKeyCapture, true);
    window.addEventListener("keydown", onKeyBubble);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);

    let lastError = "";
    const report = (msg: string) => {
      if (!msg || msg.includes("ResizeObserver") || msg === lastError) return;
      lastError = msg;
      setTimeout(() => (lastError = ""), 5000);
      toast(`Something went wrong: ${msg}`, { kind: "error" });
    };
    window.addEventListener("error", (e) => report(e.message));
    window.addEventListener("unhandledrejection", (e) => report(parseError(e.reason).message));

    unlisten.push(listen("open-files", async () => openPaths(await ipc.takePendingFiles())));
    unlisten.push(
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") ui.dropping = true;
        else if (p.type === "leave") ui.dropping = false;
        else if (p.type === "drop") {
          ui.dropping = false;
          if (p.paths.length) openPaths(p.paths);
        }
      }),
    );
    unlisten.push(
      win.onFocusChanged(({ payload: focused }) => {
        if (focused) checkExternalChanges();
        else autoSaveOnBlur();
      }),
    );
    unlisten.push(win.onResized(async () => (ui.maximized = await win.isMaximized())));
    win.isMaximized().then((m) => (ui.maximized = m));

    unlisten.push(
      win.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          if (await prepareExit()) {
            await win.destroy();
            return;
          }
        } catch (e) {
          const r = await ask({
            title: "Close Margin?",
            message: `Margin couldn't save your open tabs: ${parseError(e).message}`,
            detail: "Unsaved changes may be lost.",
            buttons: [
              { label: "Cancel", value: "cancel" },
              { label: "Close anyway", value: "close", danger: true },
            ],
            cancelValue: "cancel",
          });
          if (r === "close") await win.destroy();
        }
        closing = false;
      }),
    );

    (async () => {
      const started = (async () => {
        try {
          await restoreSession(boot.sessionText);
          const pending = await ipc.takePendingFiles();
          if (pending.length) await openPaths(pending);
        } catch (e) {
          console.error("Startup failed", e);
        }
        if (!tabsState.list.length) newTab();
      })();
      // Show the window with its content when that's quick; never wait long for a big file.
      await Promise.race([started, new Promise((r) => setTimeout(r, 250))]);
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 150))]);
      requestAnimationFrame(() => ipc.appReady().catch(() => {}));
      await started;
      if (settingsMeta.error) {
        toast(`settings.json has an error, so defaults are in use: ${settingsMeta.error}`, {
          kind: "error",
          action: { label: "Open", run: () => runCommand("settings.openJson") },
        });
      }
    })();

    return () => {
      window.removeEventListener("keydown", onKeyCapture, true);
      window.removeEventListener("keydown", onKeyBubble);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContextMenu);
      unlisten.forEach((p) => p.then((f) => f()));
    };
  });

  // Turning zen mode off through the window (e.g. Win+Up) keeps state honest.
  $effect(() => {
    if (!ui.zen) return;
    const off = win.onResized(async () => {
      if (!(await win.isFullscreen())) ui.zen = false;
    });
    return () => {
      off.then((f) => f());
    };
  });
</script>

<div class="app" class:zen={ui.zen}>
  {#if !ui.zen}
    <TitleBar />
  {/if}
  <EditorArea bind:findBar />
  {#if settings.showStatusBar && !ui.zen}
    <StatusBar />
  {/if}
</div>

{#if ui.dropping}
  <div class="drop"><div>Drop files to open</div></div>
{/if}

<CommandPalette />
<Settings />
<Menu />
<Dialog />
<Toasts />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .drop {
    position: fixed;
    inset: 8px;
    z-index: 70;
    display: grid;
    place-items: center;
    border: 2px dashed var(--accent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    color: var(--fg);
    font-size: 15px;
    pointer-events: none;
  }
</style>
