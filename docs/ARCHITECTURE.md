# How Margin works

This explains every part of Margin: the overall design, what each file does, how files are read and saved, how huge files stay fast, how tabs and sessions work, how themes and compile & run work, and why it's built this way. Use it to find your way around the code, or as a guide to rebuild the editor yourself.

## 1. The big picture

```
┌─────────────────────────── Margin.exe (Rust, Tauri 2) ───────────────────────────┐
│ files.rs    read/decode/encode/save text files (encodings, line endings, atomic) │
│ large.rs    huge files: background line index, read lines on demand, search      │
│ run.rs      compile & run programs, stream their output, send input, stop them   │
│ storage.rs  settings.json, session, unsaved-tab backups, custom themes, window   │
│ lib.rs      window creation, single instance, "open with" arguments, commands    │
│        ▲ invoke("command", args)                    │ events ("run-output"…)     │
│        │                                            ▼                            │
│ ┌──────────────────────── WebView (the UI, Svelte 5) ───────────────────────────┐│
│ │ App.svelte + components/      title bar, tabs, editor area, preview, panels   ││
│ │ lib/tabs.svelte.ts            tab list, open/save/close, session restore      ││
│ │ lib/editor/                   CodeMirror 6: one view, one state per tab       ││
│ │ lib/commands.ts               every command + keyboard shortcuts              ││
│ │ lib/settings, theme, run, sidebar, markdown …                                 ││
│ └───────────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Tauri 2** gives a small native app (Rust) that shows a web UI in the system WebView (WebView2 on Windows, WebKitGTK on Linux).
- **The Rust side does everything that touches the system**: the file system, encodings, processes, and window state. The UI calls it with `invoke("command_name", args)`; all the calls are listed in one place, `src/lib/ipc.ts`.
- **The UI is Svelte 5** (with "runes": `$state`, `$derived`, `$effect`) plus **CodeMirror 6** as the editor.
- **Errors from Rust** are strings like `"NOTFOUND:message"`; `parseError()` in `ipc.ts` splits the code from the message so the UI can react, for example by offering to reload a file.

## 2. File map

### Rust (`src-tauri/src/`)

| File | Responsibility |
|---|---|
| `lib.rs` | Builds the window and wires up the plugins (single-instance, dialog, opener). Registers every `#[tauri::command]` and collects file paths passed on the command line or by a second launch. Kills running programs on exit. |
| `files.rs` | `read_text_file` detects the encoding and BOM, decodes the text and detects line endings. `write_text_file` encodes the text and saves it atomically. Also `stat_files` (to notice external changes), `list_dir` and `is_dir` (for the sidebar). |
| `large.rs` | Large-file mode: a sparse line index built in the background, line reads on demand, and streaming regex search. |
| `run.rs` | Spawns compilers and programs with piped stdin, stdout and stderr. Streams output as events, stops whole process trees, finds tools on PATH and runs programs in a separate console. |
| `storage.rs` | App data: `settings.json`, `session.json`, backups of unsaved tabs, custom themes, and `state.json` (window size and position). Also writes the **boot script**. |

### UI (`src/`)

| Path | Responsibility |
|---|---|
| `main.ts` | Entry: loads settings and theme before the first render, then mounts `App.svelte`. |
| `App.svelte` | Layout, global keyboard handling, drag and drop, window focus, and the startup sequence (restore the session, then tell Rust `app_ready`). |
| `lib/boot.ts` | Reads `window.__MARGIN_BOOT__`, which Rust injects before any script runs. |
| `lib/ipc.ts` | Typed wrappers for every Rust command, plus the shared types. |
| `lib/tabs.svelte.ts` | The heart of the app: tab state, opening, loading, saving, closing, the reopen-closed stack, external-change detection, session save and restore. |
| `lib/editor/view.ts` | Creates CodeMirror states and builds the extensions for a configuration (font, wrap, line numbers, Vim…) as *compartments*, so they can be changed live. |
| `lib/editor/instance.ts` | Holds the single `EditorView`. |
| `lib/editor/languages.ts`, `highlight.ts` | Syntax highlighting: language detection, plus parsers that load on demand. |
| `lib/editor/transforms.ts`, `extras.ts` | Text tools (sort, dedupe, case, JSON, Base64, URL…) and small editor extras. |
| `lib/commands.ts` | A registry of every command (`id`, title, default shortcut, `run`) that feeds the palette, menus and shortcuts. Keyboard combos are matched on physical keys, so any keyboard layout works. |
| `lib/settings.svelte.ts` | The `Settings` type with defaults and allowed ranges. Loads and validates `settings.json`, applies per-file-type `overrides` and persists changes. |
| `lib/themes.ts` | Built-in themes, colour maths (mix, luminance, WCAG contrast), derives a full palette from a few base colours, imports VS Code themes. |
| `lib/theme.svelte.ts` | The current theme, light/dark following the system, and applying CSS variables. |
| `lib/markdown/` | `render.ts` turns Markdown into sanitized HTML (markdown-it, DOMPurify, math, task lists, heading anchors). `enhance.ts` adds KaTeX, Mermaid and code highlighting after rendering. `find.ts` does find-in-preview. |
| `lib/run.svelte.ts` | Compile & run flow, output panel state, stopping, program input, clickable `file:line:col` links. |
| `lib/runners.ts` | The table of languages: extensions, compile and run command templates, variables like `${file}` and `${exe}`. |
| `lib/sidebar.svelte.ts` | Files sidebar: the folder tree, which folders are expanded, revealing the active file. |
| `lib/ui.svelte.ts` | Toasts, dialogs, palette, context menus. |
| `lib/path.ts`, `platform.ts`, `encodings.ts`, `jsonc.ts` | Path helpers for Windows and POSIX, `IS_WINDOWS`, the encoding list, and JSON with comments (`settings.json` allows comments). |
| `components/` | `TitleBar`, `EditorArea`, `Preview`, `LargeViewer`, `FindBar`, `CommandPalette`, `Settings`, `Runners`, `RunPanel`, `Sidebar`, `StatusBar`, `Menu`, `Dialog`, `Toasts`. |
| `dev/mock.ts` + `dev.html` | A fake Rust backend kept in memory, so the UI can be developed in a normal browser. |

## 3. Startup without a flash

Opening a text editor should feel instant, with no white flash and no theme flicker.

1. `lib.rs` creates the window **hidden** on Windows, with a background colour that matches the last theme (`state.json`).
2. It injects a **boot script**, `window.__MARGIN_BOOT__ = {settingsText, sessionText, customThemes, paths, version}`, which runs before any page script. The UI therefore has the settings and the session immediately, without waiting for a call to Rust.
3. `main.ts` applies the settings and theme, then mounts the app. The session is restored, and the UI calls `app_ready` on the next animation frame.
4. `app_ready` restores the maximized state and shows the window. If the UI never calls it, a thread shows the window after 2.5 s anyway.
5. Window size and position are tracked on every move or resize and saved on exit. They are only reapplied if they still fit on a connected monitor.

## 4. Reading and saving files (`files.rs`)

**Reading** (`read_text_file`):
1. If the file is bigger than the large-file threshold (`largeFileMB`, 10 MB by default), the content isn't read. The UI switches to large-file mode instead (§5).
2. **Encoding detection**:
   - A BOM decides it directly (UTF-8, UTF-16 LE or BE).
   - Without a BOM, if zero bytes sit at alternating positions, the file is UTF-16 (`sniff_utf16`).
   - Otherwise, if the bytes are valid UTF-8, it's UTF-8.
   - Otherwise `chardetng` guesses (Windows-1252, Shift-JIS, GBK…).

   The user can always reopen the file in a different encoding.
3. **Decoding** uses `encoding_rs`. If some bytes couldn't be decoded, `lossy` is set and the UI warns before saving.
4. **Line endings**: the first break found decides CRLF, LF or CR, and `mixedEol` is set when the file uses more than one. The editor works with `\n` internally; the original style is restored on save.
5. Files that look binary (NUL bytes) are flagged so the UI can refuse or warn.

**Saving** (`write_text_file` → `write_atomic`):
- The text is converted back to the file's line endings and encoding, with a BOM if it had one. It fails clearly if a character can't be represented in that encoding.
- **Atomic write**: the data goes to a temporary file in the same folder, which is then renamed over the original. A crash or power cut mid-save leaves the old file intact, never a half-written one. Symlinks, hidden or system files, and folders where new files can't be created fall back to writing in place.
- The new modification time and size are returned. The UI remembers them so it can later tell whether *another* program changed the file.

## 5. Large files (`large.rs` + `LargeViewer.svelte`)

Multi-gigabyte logs can't go into a normal editor. Margin opens them in a read-only viewer instead:

- `large_open` opens the file **without locking it**, so other programs can keep writing to it, and starts a background thread.
- The thread reads the file in 4 MB chunks, counts line breaks, and every **1024 lines** stores the byte offset where that line starts. This *sparse index* is tiny: a 10-million-line file needs only about 10,000 numbers.
- To show line *N*, Rust jumps to the nearest stored checkpoint and scans at most 1023 lines forward. The UI only asks for the lines visible on screen (`large_lines`), so scrolling stays fast at any size.
- Lines longer than 10,000 characters are cut off for display.
- **Search** (`large_search`) runs a byte regex over the file in overlapping regions. Matches are returned as a line number plus offsets. The offsets are converted to UTF-16 so the UI can highlight them, because JavaScript strings are UTF-16.
- Files up to 512 MB can be switched into the normal editor if needed (`openLargeInEditor`).

## 6. Tabs, the editor and the session (`tabs.svelte.ts`)

### One editor view, many states
CodeMirror separates the **view** (the DOM) from the **state** (the document, selection and undo history). Margin creates **one** `EditorView` and gives each tab its own `EditorState`. Switching tabs:
1. `stashActive()` saves the view's current state and scroll position into the outgoing tab.
2. `mountActive()` calls `view.setState(tab's state)` and restores its scroll position.

That's why switching is instant and every tab keeps its own undo history, while only one editor DOM ever exists.

### Settings in compartments
Settings that change the editor (font, wrapping, line numbers, tab size, Vim, spell check…) are built in `view.ts` as CodeMirror **compartments**. Changing a setting sends a `reconfigure` effect instead of rebuilding the editor. Inactive tabs are updated the next time they are shown (`syncConfig`).

Font size lives in the editor's own theme, so when you zoom, CodeMirror re-measures its lines and the line numbers stay aligned.

### Lazy loading
On startup the session lists every tab, but a tab's file is only read the first time you look at it (`loadTab`). Twenty restored tabs therefore cost almost nothing at startup.

### Dirty state, saving, auto-save
- A tab is *dirty* when its document differs from what was last saved or loaded. CodeMirror documents are immutable, so the check is a cheap comparison.
- `saveTab` picks a path (Save As if needed), optionally trims trailing whitespace and adds a final newline, writes through `ipc.writeTextFile`, and records the new file stat.
- Auto-save, if enabled, saves after a pause in typing or when the window loses focus.

### External changes
On window focus and tab switch, `checkExternalChanges` stats every open file:
- A file that changed on disk is reloaded silently if the tab has no edits and the `autoReload` setting is on.
- If the tab does have edits, a bar offers **Reload** or **Keep mine**.
- A deleted file is marked as such.

### Never losing work
`scheduleSession` writes `session.json` (the open tabs, the active tab, cursor positions and settings per tab) a moment after changes. It also writes the text of dirty tabs to backup files: after about 1 s for small documents, and less often for big ones (up to 10 s). On the next start, `restoreSession` reopens everything, and unsaved text comes back from the backups even if you closed the window without saving. `prune_backups` deletes backups that no longer belong to any tab.

### Closing
Closing a dirty tab asks whether to save. `prepareExit` runs when the window closes; if `rememberUnsaved` is on, it simply saves the session and backups instead of asking. Closed tabs go onto a stack, so `Ctrl+Alt+R` reopens them.

## 7. Commands and shortcuts (`commands.ts`)

Every action is a `Command { id, title, keys, when?, run }` in a single array. That array drives three things:
- the **command palette** (`Ctrl+Shift+/`), which fuzzy-searches the titles,
- **menus**, which reference commands by id,
- **keyboard shortcuts**: `comboFromEvent` turns a key press into a canonical string like `"Ctrl+Shift+K"` using `e.code` (the physical key), so shortcuts work the same on any keyboard layout. User overrides in `settings.json → keybindings` replace the defaults.

To add a feature, write a function, add one entry to `commands`, and it appears in the palette and gets a shortcut.

## 8. Themes (`themes.ts`, `theme.svelte.ts`)

- A theme defines only a few **base colours** (background, foreground, accent, and some syntax colours). `deriveColors()` computes everything else (panels, borders, selection, line numbers, status bar…) by mixing colours.
- **Contrast enforcement**: every derived role has a minimum WCAG contrast ratio against the background. `readable()` nudges a colour darker on light themes, or lighter on dark ones, until it meets that minimum. This is why all 40 built-in themes stay legible.
- Colours are applied as **CSS variables** on `<html>`, and the CodeMirror highlight style reads the same values. Switching theme never rebuilds the editor.
- **Custom themes** are JSON files in the themes folder; `list_themes` / `save_theme` read and write them. `importVSCodeTheme` maps a VS Code theme's colours onto Margin's base colours.
- `set_window_bg` tells Rust the background colour, so the next start shows the right colour immediately.

## 9. Markdown (`lib/markdown/`, `Preview.svelte`)

- **markdown-it** renders the text. Plugins add GitHub task lists, heading anchors, `$…$` and `$$…$$` math, and source line numbers on every block.
- The HTML goes through **DOMPurify**, so scripts and event handlers in a document can never run.
- **Lazy extras**: KaTeX, Mermaid and the code highlighters are only imported when a document actually contains math, diagrams or code.
- **Fast updates**: re-rendering only replaces the top-level blocks that changed (`sync`), so the preview doesn't flicker while you type.
- **Split view scroll sync** uses the block line numbers to keep the editor and the preview aligned. Clicking a task checkbox in the preview edits that line in the source (`toggleTaskAt`).

## 10. Compile & run (`runners.ts`, `run.svelte.ts`, `run.rs`)

**Choosing the commands.** `runnerFor(path)` picks the language by file extension, from the built-in table merged with the `runners` section of `settings.json`. A command is a template:
- `${file}` is the full path, `${dir}` its folder, `${name}` the name without extension and `${base}` the file name.
- `${exe}` is the built program: `${dir}\${name}.exe` on Windows, `${dir}/${name}` on Linux.

`expand()` splits the template into arguments, with double quotes grouping, and fills in the variables.

**The flow** (`build(andRun)`):
1. Save the file. If it's a Rust file inside a Cargo project, use `cargo build` / `cargo run` instead.
2. Run the compile step, then the run step. Each step is `ipc.runStart(id, argv, cwd)`.
3. In Rust, `run_start` spawns the process with all three pipes and its own process group, without a console window. Two threads stream stdout and stderr back as `run-output` events. Text is never split in the middle of a UTF-8 character. A final `run-exit` event carries the exit code.
4. The panel shows the output as chunks, batched and capped so huge outputs don't freeze the UI. `linkify()` turns `file:line:col` into clickable links that jump to the error.
5. A line typed in the panel goes to the program's stdin (`run_input`), and `Ctrl+Z` closes stdin.

**Stopping** kills the whole process tree: `taskkill /T /F` on Windows, killing the process group on Linux. A stopped run is reported as "Stopped", not as a failure.

**C/C++ output buffering.** When stdout is a pipe, C buffers it, so a prompt printed before `scanf` wouldn't appear. For gcc/clang builds that run in the panel, Margin adds `-include margin-unbuffer.h`, a tiny header that turns stdout buffering off.

**PATH lookup** (`which`) also finds `.cmd`/`.bat` shims on Windows. `tool_info` shows each compiler's path and version in Settings → Run.

**Separate window** (setting): `run_in_console` opens `cmd` on Windows, or the user's terminal emulator on Linux, and keeps it open until a key is pressed.

## 11. Settings (`settings.svelte.ts`)

- `settings.json` lives in the config folder and may contain comments (`jsonc.ts`). Each key is validated and clamped to its allowed range, and unknown or invalid values fall back to the defaults. A file that doesn't parse leaves the current settings untouched.
- `overrides` can set per-extension values, for example `"md": { "fontFamily": "Georgia" }`. `settingsFor(path)` merges them for each tab.
- The Settings screen and the palette's toggles both write through `setSetting`, which persists the change after a short delay.

## 12. Linux differences

- The native title bar is kept (`decorations(!cfg!(windows))`), and the window is shown immediately, because some compositors never present a window that starts hidden.
- `tauri.linux.conf.json` adds `.deb`, `.rpm` and AppImage bundle targets.
- Python runs as `python3`, built programs have no `.exe`, and runs in a separate window use `$TERMINAL` or a known terminal emulator.

## 13. Why it's built this way

| Choice | Reason |
|---|---|
| Tauri, not Electron | Small installer and low memory; Rust gives fast, safe file and process handling. |
| One `EditorView` for all tabs | Tab switching is instant and the memory doesn't grow with the number of tabs. |
| Boot script injection | The first paint already has the settings and theme, so nothing flashes. |
| Sparse line index | Opens files of any size in constant memory, without locking them. |
| Atomic saves | A crash can never corrupt the file being saved. |
| Contrast-enforced themes | Every theme stays readable, including imported ones. |
| Command registry | One place to add features; the palette, menus and shortcuts come for free. |
