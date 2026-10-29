<script lang="ts">
  import { tick } from "svelte";
  import { boot } from "../lib/boot";
  import { chooseTheme, commands, runCommand, shortcutLabel } from "../lib/commands";
  import { resetSettings, setSetting, settings, settingsMeta, type Settings } from "../lib/settings.svelte";
  import { allThemes, currentTheme, themeState } from "../lib/theme.svelte";
  import type { ThemeDef } from "../lib/themes";
  import { ask, ui } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";
  import Runners from "./Runners.svelte";

  type Key = keyof Settings;
  type Opt = [string | number, string];
  type Row =
    | { kind: "toggle"; key: Key; label: string; desc?: string }
    | { kind: "select"; key: Key; label: string; desc?: string; options: Opt[] }
    | { kind: "number"; key: Key; label: string; desc?: string; min: number; max: number; step: number; unit?: string }
    | { kind: "text"; key: Key; label: string; desc?: string; list?: string[] };

  const FONTS = [
    "JetBrains Mono", "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", "Lucida Console",
    "Segoe UI", "Segoe UI Variable Text", "Calibri", "Arial", "Verdana", "Georgia", "Cambria",
    "Sitka Text", "Times New Roman", "Bahnschrift",
  ];

  const sections: { id: string; title: string; rows: Row[] }[] = [
    {
      id: "appearance",
      title: "Appearance",
      rows: [
        { kind: "text", key: "fontFamily", label: "Editor font", desc: "Any font installed on your PC.", list: FONTS },
        { kind: "number", key: "fontSize", label: "Font size", min: 8, max: 48, step: 1, unit: "px" },
        { kind: "number", key: "lineHeight", label: "Line height", min: 1, max: 3, step: 0.05 },
        { kind: "number", key: "letterSpacing", label: "Letter spacing", min: -2, max: 4, step: 0.1, unit: "px" },
        { kind: "toggle", key: "ligatures", label: "Font ligatures", desc: "Join characters like => and != when the font supports it." },
        { kind: "number", key: "zoom", label: "Zoom", min: 50, max: 300, step: 10, unit: "%" },
        { kind: "select", key: "cursorStyle", label: "Cursor style", options: [["bar", "Line"], ["block", "Block"], ["underline", "Underline"]] },
        { kind: "toggle", key: "cursorBlink", label: "Blinking cursor" },
        {
          kind: "select",
          key: "textWidth",
          label: "Text width",
          desc: "Center text in a comfortable column instead of using the full window.",
          options: [[0, "Full width"], [60, "60 characters"], [72, "72 characters"], [80, "80 characters"], [100, "100 characters"], [120, "120 characters"]],
        },
        { kind: "toggle", key: "showStatusBar", label: "Status bar" },
        { kind: "toggle", key: "reduceMotion", label: "Reduce motion", desc: "Turn off animations." },
      ],
    },
    {
      id: "editor",
      title: "Editor",
      rows: [
        { kind: "toggle", key: "wordWrap", label: "Word wrap", desc: "Alt+Z" },
        { kind: "toggle", key: "lineNumbers", label: "Line numbers" },
        { kind: "toggle", key: "highlightActiveLine", label: "Highlight current line" },
        { kind: "toggle", key: "syntaxHighlighting", label: "Syntax highlighting" },
        { kind: "toggle", key: "showWhitespace", label: "Show whitespace" },
        { kind: "toggle", key: "highlightTrailingWhitespace", label: "Highlight trailing whitespace" },
        { kind: "number", key: "tabSize", label: "Tab size", min: 1, max: 16, step: 1 },
        { kind: "toggle", key: "insertSpaces", label: "Indent with spaces" },
        { kind: "toggle", key: "detectIndentation", label: "Detect indentation from file" },
        { kind: "toggle", key: "autoCloseBrackets", label: "Auto-close brackets and quotes" },
        { kind: "toggle", key: "bracketMatching", label: "Highlight matching brackets" },
        { kind: "toggle", key: "highlightSelectionMatches", label: "Highlight other occurrences of the selection" },
        { kind: "toggle", key: "codeFolding", label: "Code folding" },
        { kind: "toggle", key: "spellcheck", label: "Spell check" },
        { kind: "toggle", key: "scrollPastEnd", label: "Scroll past the last line" },
        { kind: "select", key: "keymap", label: "Keyboard mode", options: [["default", "Standard"], ["vim", "Vim"]] },
      ],
    },
    {
      id: "markdown",
      title: "Markdown",
      rows: [
        { kind: "select", key: "markdownView", label: "Open Markdown files as", options: [["preview", "Formatted"], ["split", "Side by side"], ["source", "Plain text"]] },
        { kind: "select", key: "previewFont", label: "Preview font", options: [["sans", "Sans-serif"], ["serif", "Serif"], ["mono", "Monospace"]] },
        { kind: "number", key: "previewFontSize", label: "Preview font size", min: 10, max: 32, step: 1, unit: "px" },
        { kind: "number", key: "previewWidth", label: "Preview width", min: 400, max: 2000, step: 20, unit: "px" },
        { kind: "toggle", key: "syncScroll", label: "Sync scrolling in side-by-side view" },
        { kind: "toggle", key: "renderMath", label: "Math", desc: "Render $inline$ and $$block$$ formulas." },
        { kind: "toggle", key: "renderDiagrams", label: "Diagrams", desc: "Render ```mermaid code blocks." },
      ],
    },
    {
      id: "files",
      title: "Files",
      rows: [
        { kind: "toggle", key: "restoreSession", label: "Reopen tabs from last time" },
        { kind: "toggle", key: "rememberUnsaved", label: "Keep unsaved changes when closing", desc: "Close without being asked; your unsaved text is there next time." },
        { kind: "select", key: "autoSave", label: "Auto save", desc: "Applies to files that have been saved once.", options: [["off", "Off"], ["delay", "After a delay"], ["focus", "When switching apps"]] },
        { kind: "number", key: "autoSaveDelay", label: "Auto save delay", min: 200, max: 60000, step: 100, unit: "ms" },
        { kind: "toggle", key: "autoReload", label: "Reload files changed by other programs", desc: "Only when you have no unsaved changes." },
        { kind: "select", key: "defaultEol", label: "Line endings for new files", options: [["CRLF", "CRLF (Windows)"], ["LF", "LF (macOS, Linux)"]] },
        { kind: "select", key: "defaultEncoding", label: "Encoding for new files", options: [["UTF-8", "UTF-8"], ["UTF-16LE", "UTF-16 LE"], ["windows-1252", "Windows-1252"]] },
        { kind: "toggle", key: "trimTrailingWhitespace", label: "Trim trailing whitespace on save" },
        { kind: "toggle", key: "insertFinalNewline", label: "End files with a newline on save" },
        { kind: "number", key: "largeFileMB", label: "Large file mode above", desc: "Bigger files open instantly in a read-only viewer.", min: 1, max: 2048, step: 1, unit: "MB" },
        { kind: "toggle", key: "closeWindowWithLastTab", label: "Close the window with the last tab" },
      ],
    },
    {
      id: "writing",
      title: "Writing",
      rows: [
        { kind: "toggle", key: "focusMode", label: "Focus mode", desc: "Fade everything except the paragraph you're writing." },
        { kind: "toggle", key: "typewriterMode", label: "Typewriter scrolling", desc: "Keep the current line in the middle of the screen." },
        { kind: "toggle", key: "showWordCount", label: "Word count in status bar" },
      ],
    },
    {
      id: "run",
      title: "Run",
      rows: [
        {
          kind: "select",
          key: "runButtons",
          label: "Run buttons in the title bar",
          desc: "Compile and Run buttons for code files. Ctrl+1 and Ctrl+2 always work.",
          options: [["auto", "After the first run"], ["always", "Always"], ["never", "Never"]],
        },
        { kind: "toggle", key: "clearOutputOnRun", label: "Clear output before each run" },
        { kind: "toggle", key: "codeLineNumbers", label: "Line numbers in code files", desc: "Shown for files Margin can run, even when line numbers are off elsewhere." },
        {
          kind: "toggle",
          key: "runInTerminal",
          label: "Run programs in a separate window",
          desc: "For programs that need a real terminal (colors, clearing the screen). Compiler messages still show in Margin.",
        },
      ],
    },
  ];

  const navItems = [
    { id: "appearance", title: "Appearance" },
    { id: "editor", title: "Editor" },
    { id: "markdown", title: "Markdown" },
    { id: "files", title: "Files" },
    { id: "writing", title: "Writing" },
    { id: "run", title: "Run" },
    { id: "keyboard", title: "Keyboard" },
    { id: "about", title: "About" },
  ];

  let search = $state("");
  let searchInput: HTMLInputElement | undefined = $state();
  let content: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (ui.settingsOpen) tick().then(() => searchInput?.focus());
  });

  const q = $derived(search.trim().toLowerCase());
  const matches = (r: Row) => !q || r.label.toLowerCase().includes(q) || (r.desc ?? "").toLowerCase().includes(q) || r.key.toLowerCase().includes(q);
  const visibleSections = $derived(q ? sections.map((s) => ({ ...s, rows: s.rows.filter(matches) })).filter((s) => s.rows.length) : sections.filter((s) => s.id === ui.settingsSection));
  const shortcutRows = $derived(
    commands
      .filter((c) => !c.id.startsWith("tab.goto") || c.id === "tab.goto1")
      .map((c) => ({ c, keys: shortcutLabel(c) }))
      .filter((r) => r.keys && (!q || r.c.title.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q))),
  );
  const showKeyboard = $derived(q ? shortcutRows.length > 0 && q.length > 1 : ui.settingsSection === "keyboard");
  const showThemes = $derived(!q ? ui.settingsSection === "appearance" : "theme dark light colors".includes(q) || q.startsWith("them"));

  function get(key: Key): unknown {
    return settings[key];
  }

  function set(key: Key, value: unknown) {
    setSetting(key, value as never);
  }

  function num(row: Extract<Row, { kind: "number" }>, value: number) {
    if (!Number.isFinite(value)) return;
    const rounded = Math.round(value / row.step) * row.step;
    set(row.key, Math.min(row.max, Math.max(row.min, Number(rounded.toFixed(3)))));
  }

  function close() {
    ui.settingsOpen = false;
    search = "";
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (search) search = "";
      else close();
    }
  }

  const lightThemes = $derived(allThemes().filter((t) => !t.dark));
  const darkThemes = $derived(allThemes().filter((t) => t.dark));
  const active = $derived(currentTheme().id);

  function isSelected(t: ThemeDef) {
    return t.dark ? settings.darkTheme === t.id : settings.lightTheme === t.id;
  }

  async function reset() {
    const r = await ask({
      title: "Reset all settings?",
      message: "Every setting goes back to its default. Your files and themes are not affected.",
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Reset", value: "reset", danger: true },
      ],
      cancelValue: "cancel",
    });
    if (r === "reset") resetSettings();
  }

  function goto(id: string) {
    ui.settingsSection = id;
    search = "";
    content?.scrollTo({ top: 0 });
  }
</script>

{#snippet card(t: ThemeDef)}
  <button class="theme" class:selected={isSelected(t)} class:live={active === t.id} title={t.name} onclick={() => chooseTheme(t)}>
    <span class="swatch" style="background:{t.colors.bg}; border-color:{t.colors.border}">
      <span class="bar" style="background:{t.colors.surface}"></span>
      <span class="code">
        <i style="background:{t.colors.keyword}; width:22%"></i><i style="background:{t.colors.function}; width:34%"></i>
        <br /><i style="background:{t.colors.string}; width:46%; margin-left:10%"></i>
        <br /><i style="background:{t.colors.comment}; width:58%; margin-left:10%"></i>
        <br /><i style="background:{t.colors.type}; width:18%"></i><i style="background:{t.colors.fg}; width:28%"></i>
      </span>
    </span>
    <span class="tname">{t.name}</span>
  </button>
{/snippet}

{#if ui.settingsOpen}
  <div class="backdrop" role="presentation" onmousedown={(e) => e.target === e.currentTarget && close()}>
    <div class="settings" role="dialog" aria-label="Settings" tabindex="-1" onkeydown={onKey}>
      <nav>
        <h1>Settings</h1>
        {#each navItems as n}
          <button class="nav" class:on={!q && ui.settingsSection === n.id} onclick={() => goto(n.id)}>{n.title}</button>
        {/each}
      </nav>
      <div class="main">
        <div class="top">
          <div class="search">
            <Icon name="search" size={14} />
            <input bind:this={searchInput} bind:value={search} placeholder="Search settings" spellcheck="false" />
          </div>
          <button class="icon-btn" aria-label="Close settings" title="Close (Esc)" onclick={close}><Icon name="close" size={14} /></button>
        </div>
        <div class="content" bind:this={content}>
          {#if settingsMeta.error}
            <div class="warn">
              settings.json has an error, so changes here won't be saved until it's fixed: {settingsMeta.error}
              <button class="btn small" onclick={() => (close(), runCommand("settings.openJson"))}>Open settings.json</button>
            </div>
          {/if}

          {#if showThemes}
            <section>
              <h2>Theme</h2>
              <div class="row">
                <div class="label"><div>Mode</div></div>
                <div class="seg">
                  {#each [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as [v, l]}
                    <button class:on={settings.themeMode === v} onclick={() => set("themeMode", v)}>{l}</button>
                  {/each}
                </div>
              </div>
              <h3>Light</h3>
              <div class="themes">{#each lightThemes as t (t.id)}{@render card(t)}{/each}</div>
              <h3>Dark</h3>
              <div class="themes">{#each darkThemes as t (t.id)}{@render card(t)}{/each}</div>
              <div class="actions">
                <button class="btn small" onclick={() => runCommand("theme.import")}>Import VS Code theme…</button>
                <button class="btn small" onclick={() => (close(), runCommand("theme.customize"))}>Customize current theme</button>
                <button class="btn small" onclick={() => runCommand("theme.openFolder")}>Open themes folder</button>
              </div>
              {#if themeState.custom.length}
                <p class="note">{themeState.custom.length} custom theme{themeState.custom.length === 1 ? "" : "s"} loaded from your themes folder.</p>
              {/if}
            </section>
          {/if}

          {#each visibleSections as s (s.id)}
            <section>
              <h2>{s.title}</h2>
              {#each s.rows as r (r.key)}
                <div class="row">
                  <div class="label">
                    <div>{r.label}</div>
                    {#if r.desc}<div class="desc">{r.desc}</div>{/if}
                  </div>
                  {#if r.kind === "toggle"}
                    <button class="switch" role="switch" aria-checked={!!get(r.key)} aria-label={r.label} class:on={!!get(r.key)} onclick={() => set(r.key, !get(r.key))}>
                      <span></span>
                    </button>
                  {:else if r.kind === "select"}
                    <select
                      class="text-input"
                      value={String(get(r.key))}
                      onchange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        set(r.key, typeof r.options[0][0] === "number" ? Number(v) : v);
                      }}
                    >
                      {#each r.options as [v, l]}<option value={String(v)}>{l}</option>{/each}
                    </select>
                  {:else if r.kind === "number"}
                    <div class="stepper">
                      <button aria-label="Decrease" onclick={() => num(r, (get(r.key) as number) - r.step)}>−</button>
                      <input
                        type="number"
                        value={get(r.key)}
                        min={r.min}
                        max={r.max}
                        step={r.step}
                        onchange={(e) => num(r, Number((e.currentTarget as HTMLInputElement).value))}
                      />
                      <button aria-label="Increase" onclick={() => num(r, (get(r.key) as number) + r.step)}>+</button>
                      {#if r.unit}<span class="unit">{r.unit}</span>{/if}
                    </div>
                  {:else if r.kind === "text"}
                    <input
                      class="text-input wide"
                      value={get(r.key)}
                      list={r.list ? `list-${r.key}` : undefined}
                      spellcheck="false"
                      onchange={(e) => set(r.key, (e.currentTarget as HTMLInputElement).value.trim() || "JetBrains Mono")}
                    />
                    {#if r.list}
                      <datalist id={`list-${r.key}`}>{#each r.list as o}<option value={o}></option>{/each}</datalist>
                    {/if}
                  {/if}
                </div>
              {/each}
            </section>
          {/each}

          {#if (!q && ui.settingsSection === "run") || (q.length > 1 && "compiler interpreter runner language command gcc python".includes(q))}
            <Runners />
          {/if}

          {#if showKeyboard}
            <section>
              <h2>Keyboard</h2>
              {#if !q}
                <div class="row">
                  <div class="label">
                    <div>Keyboard mode</div>
                    <div class="desc">Vim keybindings load only when you turn them on.</div>
                  </div>
                  <select class="text-input" value={settings.keymap} onchange={(e) => set("keymap", (e.currentTarget as HTMLSelectElement).value)}>
                    <option value="default">Standard</option>
                    <option value="vim">Vim</option>
                  </select>
                </div>
                <p class="note">To change a shortcut, add it under <code>"keybindings"</code> in settings.json, e.g. <code>"run.run": "Ctrl+Enter"</code>. Command IDs are listed below.</p>
              {/if}
              <div class="keys">
                {#each shortcutRows as { c, keys } (c.id)}
                  <div class="krow" title={c.id}>
                    <span>{c.title}</span>
                    <span class="kid">{c.id}</span>
                    <kbd>{keys}</kbd>
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          {#if !q && ui.settingsSection === "about"}
            <section>
              <h2>About</h2>
              <p class="note">Margin {boot.version} — a fast, minimal text editor.</p>
              <div class="row">
                <div class="label">
                  <div>Settings file</div>
                  <div class="desc mono">{boot.paths.settings}</div>
                </div>
                <button class="btn small" onclick={() => (close(), runCommand("settings.openJson"))}>Open</button>
              </div>
              <div class="row">
                <div class="label">
                  <div>Themes folder</div>
                  <div class="desc mono">{boot.paths.themes}</div>
                </div>
                <button class="btn small" onclick={() => runCommand("theme.openFolder")}>Open</button>
              </div>
              <div class="row">
                <div class="label">
                  <div>Reset settings</div>
                  <div class="desc">Restore every option to its default.</div>
                </div>
                <button class="btn small danger" onclick={reset}>Reset…</button>
              </div>
            </section>
          {/if}

          {#if q && !visibleSections.length && !showKeyboard && !showThemes}
            <p class="empty">No settings match “{search}”.</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: rgba(0, 0, 0, 0.22);
    display: grid;
    place-items: center;
    animation: fade 0.12s ease;
  }
  .settings {
    display: flex;
    width: min(900px, calc(100vw - 40px));
    height: min(680px, calc(100vh - 70px));
    border-radius: 14px;
    background: var(--bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow: hidden;
    outline: none;
    animation: pop 0.16s var(--ease);
  }
  nav {
    width: 190px;
    flex-shrink: 0;
    padding: 18px 10px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  h1 {
    margin: 0 10px 14px;
    font-size: 16px;
    font-weight: 600;
  }
  .nav {
    height: 32px;
    padding: 0 12px;
    border-radius: 7px;
    text-align: left;
    color: var(--muted);
  }
  .nav:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .nav.on {
    background: var(--surface-2);
    color: var(--fg);
    font-weight: 600;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 10px 28px;
  }
  .search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid transparent;
    color: var(--faint);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--fg);
    user-select: text;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 28px 28px;
  }
  section + section {
    margin-top: 26px;
  }
  h2 {
    margin: 8px 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 50px;
    padding: 8px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .desc {
    margin-top: 2px;
    font-size: 12px;
    color: var(--faint);
  }
  .mono {
    font-family: var(--mono-font);
    font-size: 11px;
    overflow-wrap: anywhere;
    user-select: text;
  }
  select.text-input {
    min-width: 170px;
    padding-right: 6px;
  }
  .text-input.wide {
    width: 220px;
  }
  .switch {
    position: relative;
    width: 40px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 11px;
    border: 1px solid var(--faint);
    transition: background 0.15s, border-color 0.15s;
  }
  .switch span {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform 0.18s var(--ease), background 0.15s, width 0.15s;
  }
  .switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch.on span {
    transform: translateX(18px);
    background: var(--accent-fg);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .stepper button {
    width: 26px;
    height: 28px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 15px;
  }
  .stepper button:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .stepper input {
    width: 64px;
    height: 28px;
    text-align: center;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    outline: none;
    user-select: text;
  }
  .stepper input:focus {
    border-color: var(--accent);
  }
  .stepper input::-webkit-inner-spin-button {
    display: none;
  }
  .unit {
    min-width: 22px;
    color: var(--faint);
    font-size: 12px;
  }
  .seg {
    display: flex;
    padding: 2px;
    border-radius: 8px;
    background: var(--surface);
  }
  .seg button {
    height: 26px;
    padding: 0 14px;
    border-radius: 6px;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--surface-2);
    color: var(--fg);
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 10px;
  }
  .theme {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px;
    border-radius: 10px;
    text-align: left;
  }
  .theme:hover {
    background: var(--surface);
  }
  .swatch {
    display: block;
    height: 64px;
    border-radius: 7px;
    border: 1px solid;
    overflow: hidden;
    box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 0.12s;
  }
  .theme.selected .swatch {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .bar {
    display: block;
    height: 10px;
  }
  .code {
    display: block;
    padding: 6px 8px;
    line-height: 9px;
  }
  .code i {
    display: inline-block;
    height: 4px;
    margin-right: 4px;
    border-radius: 2px;
  }
  .tname {
    font-size: 12px;
    color: var(--muted);
    padding: 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .theme.live .tname {
    color: var(--fg);
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  .note {
    color: var(--faint);
    font-size: 12px;
    line-height: 1.6;
    user-select: text;
  }
  .note code {
    font-family: var(--mono-font);
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--surface);
  }
  .keys {
    display: flex;
    flex-direction: column;
  }
  .krow {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
  }
  .krow span:first-child {
    flex: 1;
  }
  .kid {
    color: var(--faint);
    font: 11px var(--mono-font);
    user-select: text;
  }
  .krow kbd {
    min-width: 110px;
    text-align: right;
    font-size: 12px;
    color: var(--muted);
  }
  .warn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--fg);
    font-size: 12.5px;
  }
  .empty {
    color: var(--faint);
    padding: 20px 0;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
</style>
