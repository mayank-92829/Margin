# Changelog

## 1.3.1 — 2026-11-11

### Fixed & Improved
- Content-based language auto-detection: typing or pasting code into an untitled unsaved tab immediately auto-detects the programming language (e.g. `print(...)` -> Python, `#include <stdio.h>` -> C, `fn main` -> Rust, `<!DOCTYPE html>` -> HTML, `package main` -> Go, `public class` -> Java, `console.log` -> JavaScript) and applies syntax highlighting in real time.
- Silent window close: closing Margin with unsaved tabs discards unsaved tabs and scratch files immediately without prompting "Save changes?", closing clean and starting fresh on next launch.
- Silent tab close for unsaved tabs: closing an individual untitled scratch tab closes immediately without save prompt.

## 1.3.0 — 2026-11-11

### Added
- Rename unsaved tabs: double-click tab title or right-click → "Rename tab…" to type a name with extension (e.g. `main.c`, `test.cpp`), immediately activating that language mode and runner.
- Quick shortcut `Alt+L`: instantly opens the searchable language picker.
- Quick Open (`Ctrl+P`): fuzzy-search and jump to any file when a folder or project is open in the sidebar.
- Column / Box Selection: `Alt+Drag` rectangular selection and `Alt+Shift+Up/Down` / `Ctrl+Alt+Up/Down` to insert multi-line cursors.
- Format Document / Selection (`Shift+Alt+F` / `Ctrl+Shift+I`): syntax-aware code indentation and JSON formatting.
- Fresh startup mode: Margin starts fresh with a single clean tab on launch, closing old saved tabs and clearing unsaved scratch.
- Automatic temp file cleanup: scratch runner files in `%TEMP%` are deleted automatically when tabs close or the app exits.

## 1.2.0 — 2026-11-11

### Added
- File type / language selector in the title bar (left of the menu button) to select any language mode for both saved and unsaved files.
- Run unsaved code: compile and run unsaved tabs without needing to save them to disk first (executed seamlessly via temporary scratch files).
- Pre-fill matching file extension and filters when saving an untitled file with a selected language mode.

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
