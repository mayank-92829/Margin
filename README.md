# Margin

A fast, minimal text editor for Windows and Linux — Notepad's simplicity with a real editor underneath.

- **Opens instantly**, even multi‑gigabyte files (they open in a read‑only viewer with search; files up to 512 MB can be switched to full editing).
- **Markdown opens formatted** by default — or side‑by‑side / plain text (Settings → Markdown). Tables, task checkboxes you can click, highlighted code, math (`$…$`, `$$…$$`) and Mermaid diagrams.
- **Stays out of the way**: it looks like Notepad until you ask for more. The run buttons and output panel appear the first time you press `Ctrl+1`; the sidebar only when you open it.
- **Compile & run** C, C++, Rust, Go, Java, Python, JavaScript and more with one key. Output appears in a panel under the editor, programs can read input you type there, and compiler errors are clickable.
- **Files sidebar** (`Ctrl+B`) for the folder you're working in — follows the file you're editing and slides away when you don't need it.
- **40 themes** (light + dark pairs, high contrast), all checked for readable contrast, follows the system light/dark mode, live preview while choosing. Import any VS Code theme, or customize one as a JSON file.
- **Never loses work**: unsaved tabs are kept when you close the window and come back next time. Saves are atomic (a crash mid‑save can't corrupt a file).
- Tabs, find & replace (regex, whole word, case), go to line, multi‑cursor, 100+ languages, encodings (UTF‑8/16, Windows code pages, Shift‑JIS, GBK, …), CRLF/LF, auto‑save, focus & typewriter modes, zen mode, Vim mode, spell check, text tools (sort, dedupe, case, JSON, Base64, URL…).
- Everything else lives in the **command palette** (`Ctrl+Shift+/`) so the window stays clean.

## Download

Get the latest version from [Releases](https://github.com/mayank-92829/Margin/releases/latest):

| | |
|---|---|
| Windows 10/11 | `Margin_<version>_x64-setup.exe` — installs per-user, no admin needed |
| Debian, Ubuntu, Mint | `Margin_<version>_amd64.deb` — `sudo apt install ./Margin_<version>_amd64.deb` |
| Fedora, openSUSE | `Margin-<version>-1.x86_64.rpm` — `sudo dnf install ./Margin-<version>-1.x86_64.rpm` |
| Any Linux | `Margin_<version>_amd64.AppImage` — `chmod +x` it and run |

Compile & run uses the compilers already on your system (gcc, python, …); Margin doesn't bundle any.

## Run & build

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # release build + installer
```

**Windows** — needs Rust (MSVC toolchain), Node 20+, Visual Studio Build Tools and WebView2 (built into Windows 11). The installer is written to `src-tauri/target/release/bundle/nsis/`. It installs per‑user (no admin), adds "Open with" entries for `.txt`/`.md`/`.log`/… and an **Edit with Margin** item to the Explorer right‑click menu.

**Linux** — needs Rust, Node 20+ and the WebKitGTK development packages. On Debian/Ubuntu:

```bash
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

(Fedora: `sudo dnf install webkit2gtk4.1-devel openssl-devel libxdo-devel libappindicator-gtk3-devel librsvg2-devel` plus the "C Development Tools and Libraries" group.) `npm run tauri build` then produces `.deb`, `.rpm` and AppImage packages in `src-tauri/target/release/bundle/`. On Linux, Margin uses the desktop's own title bar.

To work on the UI without the Rust side, run `npm run dev` and open `http://localhost:1420/dev.html` — it uses an in‑memory fake backend (`src/dev/mock.ts`).

## Shortcuts

Everything works without the F-keys (which need `Fn` on most laptops); `F1`, `F3` and `F11` remain as extras.

| | |
|---|---|
| New tab / Open / Save / Save as | `Ctrl+N` · `Ctrl+O` · `Ctrl+S` · `Ctrl+Shift+S` |
| Close tab / Reopen closed tab | `Ctrl+W` · `Ctrl+Alt+R` |
| Next / previous tab, tab 1–9 | `Ctrl+Tab` · `Ctrl+Shift+Tab` · `Alt+1…9` |
| Find / Replace / next / previous | `Ctrl+F` · `Ctrl+H` · `Enter` / `Shift+Enter` in the find bar (or `F3` · `Shift+F3`) |
| Go to line | `Ctrl+G` |
| Command palette | `Ctrl+Shift+/` or `F1` |
| Compile & run / compile / stop | `Ctrl+1` · `Ctrl+2` · `Ctrl+Shift+X` |
| Output panel / sidebar / open folder | `Ctrl+J` · `Ctrl+B` · `Ctrl+Shift+O` |
| Settings / Theme / Light↔Dark | `Ctrl+,` · `Ctrl+Alt+T` · `Ctrl+Alt+D` |
| Markdown preview / side by side | `Ctrl+E` · `Ctrl+Shift+E` |
| Word wrap / line numbers | `Alt+Z` · `Ctrl+Alt+L` |
| Zoom | `Ctrl+=` · `Ctrl+-` · `Ctrl+0` · `Ctrl+wheel` |
| Zen mode | `Ctrl+Alt+Z` |
| Insert time/date | `Ctrl+Shift+;` |
| Select next occurrence / all occurrences | `Ctrl+D` · `Ctrl+Shift+L` |
| Move / duplicate / delete line | `Alt+↑↓` · `Shift+Alt+↓` · `Ctrl+Shift+K` |

Any shortcut can be changed in `settings.json` under `"keybindings"` (Settings → Keyboard lists the command IDs).

## Compile & run

In a file with a supported extension, press **Compile & Run** (`Ctrl+1`) or **Compile** (`Ctrl+2`). The first run opens the output panel and adds both buttons to the title bar for later runs. The file is saved first. Margin uses whatever compilers are on your `PATH`:

| Extension | Compile | Run |
|---|---|---|
| `.c` | `gcc "${file}" -o "${exe}" -Wall -g` | `"${exe}"` |
| `.cpp` `.cc` `.cxx` | `g++ "${file}" -o "${exe}" -Wall -g` | `"${exe}"` |
| `.rs` | `rustc "${file}" -o "${exe}" -g` (or `cargo build` inside a Cargo project) | `"${exe}"` (or `cargo run`) |
| `.go` | `go build -o "${exe}" "${file}"` | `"${exe}"` |
| `.java` | `javac "${file}"` | `java -cp "${dir}" "${name}"` |
| `.py` | syntax check | `python -u "${file}"` |
| `.js` `.ts` `.rb` `.lua` `.php` `.pl` `.dart` `.sh` `.ps1` `.bat` | — / syntax check | the matching interpreter |

Change any of these, or add a language, in **Settings → Run → Languages** — it also shows which compiler each language will use and its version. The same commands live in `settings.json` under `"runners"`:

```jsonc
"runners": {
  "c":   { "compile": "C:\\msys64\\ucrt64\\bin\\gcc.exe \"${file}\" -o \"${exe}\" -O2 -Wall" },
  "cpp": { "compile": "C:\\msys64\\ucrt64\\bin\\g++.exe \"${file}\" -o \"${exe}\" -std=c++20 -Wall -g" },
  "kt":  { "compile": "kotlinc \"${file}\" -include-runtime -d \"${dir}\\${name}.jar\"", "run": "java -jar \"${dir}\\${name}.jar\"" }
}
```

Variables: `${file}` full path, `${dir}` its folder, `${name}` file name without extension, `${base}` file name, `${exe}` = `${dir}\${name}.exe`.

Programs run in the output panel with their working directory set to the file's folder; type into the input line to send them text (`Ctrl+Z` ends input, `Ctrl+C` or `Ctrl+Shift+X` stops them, `Esc` hides the panel — a running program keeps going and shows in the status bar). Click any `file:line:col` in compiler output to jump there. C and C++ programs built for the panel get unbuffered `stdout`, so prompts appear before `scanf` waits. For programs that need a real terminal, turn on **Settings → Run → Run programs in a separate window** (on Linux this opens your terminal emulator — set `$TERMINAL` to choose one).

On Linux, built programs are named `${dir}/${name}` (no `.exe`) and Python runs as `python3`.

## Where things are stored

Windows paths are shown; on Linux they are `~/.config/com.margin.editor/` and `~/.local/share/com.margin.editor/`.

- Settings: `%APPDATA%\com.margin.editor\settings.json` (comments allowed). Per‑file‑type overrides go under `"overrides"`, e.g. `"md": { "fontFamily": "Georgia", "textWidth": 72 }`.
- Custom themes: `%APPDATA%\com.margin.editor\themes\*.json` — saved changes apply instantly.
- Open tabs and unsaved text: `%LOCALAPPDATA%\com.margin.editor\`.

## How it's built

- **Tauri 2 (Rust)** — file I/O, encoding detection (`encoding_rs` + `chardetng`), atomic saves, and the large‑file engine: a sparse line index built in the background so any line of a huge file is a few KB of reading away, plus streaming regex search. Files are never locked against other programs.
- **CodeMirror 6** — the editor; only visible lines are drawn, so big documents stay smooth. One editor view is reused across tabs (each tab keeps its own state and undo history).
- **Svelte 5** — the UI. Themes are CSS variables, so switching is instant and never rebuilds the editor.
- Markdown is rendered with `markdown-it` and sanitized with DOMPurify; KaTeX, Mermaid and language parsers load only when a document needs them.

```
src-tauri/src/files.rs    reading/writing, encodings, line endings, safe saves
src-tauri/src/large.rs    large-file viewer backend (index, lines, search)
src-tauri/src/storage.rs  settings, session, backups, themes, window state
src/lib/tabs.svelte.ts    tabs, open/save/close, session restore, external changes
src-tauri/src/run.rs      compiler/program runner (output streaming, input, stop)
src/lib/commands.ts       every command + keyboard shortcuts
src/lib/run.svelte.ts     compile & run: language commands, output panel state
src/lib/sidebar.svelte.ts files sidebar
src/lib/themes.ts         built-in themes, VS Code theme import
src/components/           title bar, editor area, preview, find bar, palette, settings…
```
