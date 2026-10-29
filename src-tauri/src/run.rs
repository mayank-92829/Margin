//! Running compilers, interpreters and the programs they build, with output streamed to the UI.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

struct Running {
    pid: u32,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct Runs(Arc<Mutex<HashMap<u32, Running>>>);

#[derive(Serialize, Clone)]
struct Output {
    id: u32,
    err: bool,
    text: String,
}

#[derive(Serialize, Clone)]
struct Exit {
    id: u32,
    code: Option<i32>,
    ms: u64,
}

/// stdout is fully buffered when it's a pipe, so prompts printed before `scanf` would never
/// show. Programs built with gcc/clang for the output panel get stdout unbuffered instead.
const UNBUFFER_H: &str = "#include <stdio.h>\n\
__attribute__((constructor)) static void margin_unbuffered_stdout(void) { setvbuf(stdout, NULL, _IONBF, 0); }\n";

fn unbuffer_header() -> Option<String> {
    let path = std::env::temp_dir().join("margin-unbuffer.h");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(UNBUFFER_H) {
        std::fs::write(&path, UNBUFFER_H).ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}

fn is_c_compiler(program: &str) -> bool {
    let name = program.rsplit(['\\', '/']).next().unwrap_or(program).to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    matches!(name, "gcc" | "g++" | "cc" | "c++" | "clang" | "clang++") || name.ends_with("-gcc") || name.ends_with("-g++")
}

/// Finds a bare program name on PATH, including `.cmd`/`.bat` shims (npx, yarn…) that
/// `Command` wouldn't find by itself.
fn resolve(program: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(program);
    if p.components().count() > 1 || p.extension().is_some() {
        return p.to_path_buf();
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for ext in ["exe", "cmd", "bat", "com"] {
                let candidate = dir.join(format!("{program}.{ext}"));
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    p.to_path_buf()
}

fn spawn_error(program: &str, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!("NOTFOUND:“{program}” wasn't found. Install it, add it to PATH, or change the command under \"runners\" in settings.json.")
    } else {
        format!("SPAWN:Couldn't start {program}: {e}")
    }
}

/// Streams a pipe to the UI, never splitting a UTF-8 character across two events.
fn pump(app: AppHandle, id: u32, err: bool, mut src: impl Read) {
    let mut buf = vec![0u8; 16 * 1024];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let n = match src.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        carry.extend_from_slice(&buf[..n]);
        let valid = match std::str::from_utf8(&carry) {
            Ok(_) => carry.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(_) => carry.len(),
        };
        let text = String::from_utf8_lossy(&carry[..valid]).into_owned();
        carry.drain(..valid);
        if !text.is_empty() {
            let _ = app.emit("run-output", Output { id, err, text });
        }
    }
    if !carry.is_empty() {
        let _ = app.emit("run-output", Output { id, err, text: String::from_utf8_lossy(&carry).into_owned() });
    }
}

/// Starts `argv` in `cwd`. Output arrives as `run-output` events, then one `run-exit`.
#[tauri::command]
pub fn run_start(app: AppHandle, runs: State<'_, Runs>, id: u32, argv: Vec<String>, cwd: String, unbuffer: bool) -> Result<(), String> {
    let (program, rest) = argv.split_first().ok_or("SPAWN:Nothing to run.")?;
    let mut cmd = Command::new(resolve(program));
    if unbuffer && is_c_compiler(program) {
        if let Some(h) = unbuffer_header() {
            cmd.arg("-include").arg(h);
        }
    }
    cmd.args(rest)
        .current_dir(&cwd)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| spawn_error(program, e))?;
    let out = child.stdout.take().map(|s| {
        let app = app.clone();
        std::thread::spawn(move || pump(app, id, false, s))
    });
    let err = child.stderr.take().map(|s| {
        let app = app.clone();
        std::thread::spawn(move || pump(app, id, true, s))
    });
    runs.0.lock().unwrap().insert(id, Running { pid: child.id(), stdin: child.stdin.take() });
    let table = runs.0.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        // Deliver all output before announcing the exit.
        for t in [out, err].into_iter().flatten() {
            let _ = t.join();
        }
        table.lock().unwrap().remove(&id);
        let _ = app.emit("run-exit", Exit { id, code, ms: started.elapsed().as_millis() as u64 });
    });
    Ok(())
}

/// Sends text to a running program's standard input; `close` signals end of input.
#[tauri::command]
pub fn run_input(runs: State<'_, Runs>, id: u32, text: String, close: bool) -> Result<(), String> {
    let mut table = runs.0.lock().unwrap();
    let Some(r) = table.get_mut(&id) else { return Ok(()) };
    if let Some(stdin) = r.stdin.as_mut() {
        if !text.is_empty() {
            stdin.write_all(text.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| format!("INPUT:{e}"))?;
        }
    }
    if close {
        r.stdin = None;
    }
    Ok(())
}

/// Stops a running program and everything it started.
#[tauri::command]
pub fn run_kill(runs: State<'_, Runs>, id: u32) {
    let pid = runs.0.lock().unwrap().get(&id).map(|r| r.pid);
    if let Some(pid) = pid {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"', '&', '|', '<', '>', '^', '(', ')']) {
        arg.to_string()
    } else {
        format!("\"{}\"", arg.replace('"', "\"\""))
    }
}

/// Runs `argv` in its own console window that stays open until a key is pressed.
#[tauri::command]
pub fn run_in_console(argv: Vec<String>, cwd: String, title: String) -> Result<(), String> {
    let program = argv.first().ok_or("SPAWN:Nothing to run.")?;
    let line = argv.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ");
    let title = title.replace(['&', '|', '<', '>', '^', '"'], "");
    let script = format!("/S /C \"title {title} & {line} & echo. & pause\"");
    Command::new("cmd")
        .raw_arg(script)
        .current_dir(&cwd)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| spawn_error(program, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_c_compilers() {
        assert!(is_c_compiler("gcc"));
        assert!(is_c_compiler(r"C:\msys64\ucrt64\bin\g++.exe"));
        assert!(is_c_compiler("x86_64-w64-mingw32-gcc"));
        assert!(!is_c_compiler("rustc"));
        assert!(!is_c_compiler("python"));
    }

    #[test]
    fn quotes_for_cmd() {
        assert_eq!(quote("a.exe"), "a.exe");
        assert_eq!(quote(r"C:\My Code\a.exe"), r#""C:\My Code\a.exe""#);
        assert_eq!(quote("a&b"), r#""a&b""#);
    }

    #[test]
    fn resolves_cmd_shims() {
        assert!(resolve("cmd").to_string_lossy().to_lowercase().ends_with("cmd.exe"));
        assert_eq!(resolve(r"C:\x\y.exe"), std::path::PathBuf::from(r"C:\x\y.exe"));
    }
}
