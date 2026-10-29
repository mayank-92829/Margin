# Changelog

## 1.1.0 — 2026-10-30

### Added
- Linux support: `.deb`, `.rpm` and AppImage builds, native title bar, Linux paths, `python3`, terminal-emulator runs, stopping whole process groups.
- Settings → Run → Languages: see which compiler or interpreter each language uses (path and version, or "not found"), edit its compile/run commands, reset them, or add new file types.
- Settings → Run: show run buttons after the first run / always / never, keep or clear output between runs, line numbers just for code files.
- Programs still running are stopped when Margin quits.
- The sidebar follows the file you're editing (opens its folders and scrolls to it).
- `Esc` hides the output panel; a program that's still running (or a failed build) shows in the status bar — click it to bring the panel back.
- "Compile & run" and "Compile" in the ⋯ menu for code files.
- Compile & run for C, C++, Rust (incl. Cargo projects), Go, Java, Python, JavaScript/TypeScript, Ruby, Lua, PHP, Perl, Dart, shell, PowerShell and batch files — `Ctrl+1` to compile & run, `Ctrl+2` to compile, `Ctrl+Shift+X` to stop.
- Output panel (`Ctrl+J`) with live output, input for the running program, and clickable compiler errors. Commands are configurable under `"runners"` in `settings.json`; optional separate console window (Settings → Run).
- Files sidebar (`Ctrl+B`, open a folder with `Ctrl+Shift+O` or by dropping it on the window), remembered between sessions.
- Color swatches in the theme picker.

### Changed
- The window stays as plain as Notepad: run buttons appear only after the first run, the sidebar only when opened.
- Shortcuts no longer depend on F-keys: command palette `Ctrl+Shift+/`, go to tab `Alt+1…9`, reopen closed tab `Ctrl+Alt+R`, zen mode `Ctrl+Alt+Z`, insert date/time `Ctrl+Shift+;`.
- All built-in themes now meet minimum contrast for text, syntax colors, line numbers and buttons (14 themes were hard to read before, mostly the light ones).

### Fixed
- Stopping a program on Windows was reported as "failed (exit code 1)"; it now says "Stopped".
- `Ctrl+1` in a file that can't be run saved it before saying so; now it only explains, with a shortcut to Settings → Run.
- Large program output no longer slows the panel down (output is redrawn in small pieces).
- Messages no longer cover the output panel, which also can't grow taller than the window anymore.
- Focus returns to the editor when a program you were typing into ends.
- Line numbers drifting out of line with the text after zooming (`Ctrl+=` / `Ctrl+-` / `Ctrl+wheel`).
- Line numbers staying at the far left when a text width is set.
