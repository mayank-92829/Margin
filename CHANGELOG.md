# Changelog

## Unreleased

### Added
- Compile & run for C, C++, Rust (incl. Cargo projects), Go, Java, Python, JavaScript/TypeScript, Ruby, Lua, PHP, Perl, Dart, shell, PowerShell and batch files — `Ctrl+1` to compile & run, `Ctrl+2` to compile, `Ctrl+Shift+X` to stop.
- Output panel (`Ctrl+J`) with live output, input for the running program, and clickable compiler errors. Commands are configurable under `"runners"` in `settings.json`; optional separate console window (Settings → Run).
- Files sidebar (`Ctrl+B`, open a folder with `Ctrl+Shift+O` or by dropping it on the window), remembered between sessions.
- Color swatches in the theme picker.

### Changed
- The window stays as plain as Notepad: run buttons appear only after the first run, the sidebar only when opened.
- Shortcuts no longer depend on F-keys: command palette `Ctrl+Shift+/`, go to tab `Alt+1…9`, reopen closed tab `Ctrl+Alt+R`, zen mode `Ctrl+Alt+Z`, insert date/time `Ctrl+Shift+;`.
- All built-in themes now meet minimum contrast for text, syntax colors, line numbers and buttons (14 themes were hard to read before, mostly the light ones).

### Fixed
- Line numbers drifting out of line with the text after zooming (`Ctrl+=` / `Ctrl+-` / `Ctrl+wheel`).
- Line numbers staying at the far left when a text width is set.
