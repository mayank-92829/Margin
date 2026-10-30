# Developing Margin

How to set up, run, test, build and release Margin, and how to extend it. For how the code works, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Setup

### Windows
| Tool | Get it |
|---|---|
| Node.js 20+ | nodejs.org (LTS) |
| Rust, MSVC toolchain | rustup.rs, then `rustup default stable-msvc` |
| Visual Studio Build Tools | the "Desktop development with C++" workload |
| WebView2 | built into Windows 11 |

### Linux (Debian/Ubuntu, also works in WSL)
```bash
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
Plus Node 20+ (or see §4.2 for building Linux packages without Node).

Then, in the project folder: `npm install`.

## 2. Everyday commands

```bash
npm run tauri dev     # the real app with hot reload for the UI
npm run dev           # UI only, in a browser: http://localhost:1420/dev.html (fake backend in src/dev/mock.ts)
npm run check         # Svelte + TypeScript type check
npm run build         # bundle the UI into dist/
cd src-tauri && cargo test   # Rust tests (encodings, atomic saves, large files, runner)
```

**Debugging:**
- In `tauri dev`, right-click → **Inspect** opens DevTools for the UI.
- Rust `println!`/`eprintln!` output appears in the terminal.
- Dev builds expose internals on `window` for testing from the console (see `src/main.ts`).

## 3. Where Margin keeps its data

| | Windows | Linux |
|---|---|---|
| settings.json, themes/ | `%APPDATA%\com.margin.editor\` | `~/.config/com.margin.editor/` |
| session.json, backups/, state.json | `%LOCALAPPDATA%\com.margin.editor\` | `~/.local/share/com.margin.editor/` |

Deleting these folders resets Margin completely.

## 4. Releasing

1. Bump the version in **three** places: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Add a section at the top of `CHANGELOG.md` (Added / Changed / Fixed).
3. Build each platform (below).
4. Commit, tag and push: `git commit -am "Release x.y.z" && git tag vx.y.z && git push --tags origin main`.
5. On GitHub, create the release `vx.y.z` and upload the files plus `SHA256SUMS.txt` (`sha256sum * > SHA256SUMS.txt`).

### 4.1 Windows
```bash
npm run tauri build
```
→ `src-tauri/target/release/bundle/nsis/Margin_x.y.z_x64-setup.exe`. The NSIS hooks in `src-tauri/windows/hooks.nsh` add the "Edit with Margin" Explorer menu.

### 4.2 Linux (.deb, .rpm, AppImage)
On a Linux machine or in WSL with Node installed, run `npm run tauri build`.

**Without Node in WSL** (how 1.1.0 was built): build the UI on Windows first (`npm run build`), then in WSL, from the project folder:
```bash
cargo install tauri-cli --version "^2"
cargo tauri build --config '{"build":{"beforeBuildCommand":""}}'
```
→ `src-tauri/target/release/bundle/{deb,rpm,appimage}/`. Linux-only bundle settings live in `src-tauri/tauri.linux.conf.json`.

**WSL tip:** if the app's window shows in the taskbar but never appears, WSLg is stuck. Run `wsl --shutdown` from Windows and try again.

## 5. Extending Margin

### Add a command (and shortcut)
In `src/lib/commands.ts`, add an entry to `commands`:
```ts
{ id: "text.reverseLines", title: "Reverse lines", keys: ["Ctrl+Alt+V"], run: () => edit(reverseLines) },
```
It appears in the palette automatically, and users can rebind it in `settings.json → keybindings`.

### Add a setting
1. Add it to `Settings`, `DEFAULTS` (and to the ranges if it's numeric) in `src/lib/settings.svelte.ts`.
2. If it affects the editor, add it to `EditorConfig` and its compartment in `src/lib/editor/view.ts`, and pass it in `editorConfigFor` (`tabs.svelte.ts`).
3. Add a control in `src/components/Settings.svelte`.

### Add a built-in theme
Add a `ThemeDef` with base colours to `src/lib/themes.ts`; the rest of the palette is derived and contrast-checked automatically. Themes come in light and dark pairs.

### Add a language to compile & run
Add an entry to `LANGUAGES` in `src/lib/runners.ts` (`name`, `exts`, `runner: { compile?, run }`), or, without rebuilding, add it to `"runners"` in `settings.json` or in Settings → Run → Languages.

### Add a Rust command
1. Write `#[tauri::command] pub fn my_command(...) -> Result<T, String>` in the right module.
2. Register it in `generate_handler![...]` in `src-tauri/src/lib.rs`.
3. Add a typed wrapper in `src/lib/ipc.ts`, and a fake version in `src/dev/mock.ts` so browser development keeps working.
4. If it uses a plugin or a window API, add the permission in `src-tauri/capabilities/default.json`.

## 6. Release checklist

- [ ] `npm run check` and `cargo test` pass.
- [ ] Open: a UTF-8 file, a UTF-16 file, a Windows-1252 file and a >10 MB log (large viewer, search).
- [ ] Edit, save, reopen: encoding and line endings are preserved.
- [ ] Close with unsaved tabs, then reopen: the text is restored.
- [ ] Change a file in another program: Margin notices.
- [ ] `Ctrl+1` on a C file that reads input: the prompt appears and input works; `Ctrl+Shift+X` stops it.
- [ ] Markdown preview: tables, task checkboxes, math, Mermaid.
- [ ] Zoom in and out: line numbers stay aligned. Switch a few light and dark themes.

## 7. Rebuilding it yourself (learning path)

Each step gives you something that runs:

1. **Tauri + CodeMirror:** an app showing one CodeMirror editor; open and save with `fs` commands.
2. **Rust file I/O:** encoding detection with `encoding_rs`/`chardetng`, line endings, atomic save (temp file + rename).
3. **Tabs:** one `EditorView`, an `EditorState` per tab, swapped with `setState`.
4. **Commands:** a registry, a palette, and shortcuts matched on `e.code`.
5. **Settings + themes:** a JSON file, CSS variables, then derived palettes with contrast checks.
6. **Session:** save the open tabs and back up unsaved text; restore on startup.
7. **Markdown preview** with markdown-it + DOMPurify, then split view.
8. **Large files:** a sparse line index in a background thread, plus a virtual-scrolling viewer.
9. **Compile & run:** spawn processes with pipes, stream output as events, kill process trees.
10. **Polish:** boot-script injection (no flash), custom title bar, single instance, installers.
