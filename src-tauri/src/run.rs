//! Running compilers, interpreters and the programs they build, with output streamed to the UI.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
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

/// Finds a program on PATH. On Windows this includes `.cmd`/`.bat` shims (npx, yarn…) that
/// `Command` wouldn't find by itself.
fn which(program: &str) -> Option<PathBuf> {
    let p = std::path::Path::new(program);
    if p.components().count() > 1 {
        return p.is_file().then(|| p.to_path_buf());
    }
    let exts: &[&str] = if cfg!(windows) && p.extension().is_none() { &["exe", "cmd", "bat", "com"] } else { &[""] };
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        for ext in exts {
            let candidate = if ext.is_empty() { dir.join(program) } else { dir.join(format!("{program}.{ext}")) };
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn resolve(program: &str) -> PathBuf {
    which(program).unwrap_or_else(|| PathBuf::from(program))
}

/// A command that never flashes a console window on Windows and can be stopped as a group.
fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = quiet("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    };
    #[cfg(unix)]
    let mut cmd = {
        let mut c = Command::new("kill");
        c.args(["-KILL", "--", &format!("-{pid}")]);
        c
    };
    let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
}

fn spawn_error(program: &str, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!("NOTFOUND:“{program}” wasn't found. Install it, add it to PATH, or change its command in Settings → Run.")
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
    let mut cmd = quiet(resolve(program));
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
        .stderr(Stdio::piped());
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
        let status = child.wait().ok();
        // Deliver all output before announcing the exit.
        for t in [out, err].into_iter().flatten() {
            let _ = t.join();
        }
        table.lock().unwrap().remove(&id);
        let code = status.and_then(exit_code);
        let _ = app.emit("run-exit", Exit { id, code, ms: started.elapsed().as_millis() as u64 });
    });
    Ok(())
}

#[cfg(unix)]
fn exit_code(s: std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    // Killed by a signal other than our own stop: report it like a shell would (128 + signal).
    s.code().or_else(|| s.signal().filter(|&sig| sig != 9).map(|sig| 128 + sig))
}

#[cfg(not(unix))]
fn exit_code(s: std::process::ExitStatus) -> Option<i32> {
    s.code()
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
        kill_tree(pid);
    }
}

/// Stops every program still running (when Margin quits).
pub fn kill_all(runs: &Runs) {
    let pids: Vec<u32> = runs.0.lock().unwrap().values().map(|r| r.pid).collect();
    for pid in pids {
        kill_tree(pid);
    }
}

#[derive(Serialize)]
pub struct ToolInfo {
    path: String,
    version: String,
}

/// Where a compiler or interpreter is and which version it is, for Settings → Run.
#[tauri::command(async)]
pub fn tool_info(program: String) -> Option<ToolInfo> {
    let path = which(&program)?;
    let name = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let flag = match name.as_str() {
        "go" | "dart" => Some("version"),
        "java" => Some("-version"),
        "lua" => Some("-v"),
        "cmd" | "powershell" | "bash" | "sh" => None,
        _ => Some("--version"),
    };
    let mut version = String::new();
    if let Some(flag) = flag {
        if let Ok(mut child) = quiet(&path).arg(flag).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            let deadline = Instant::now() + Duration::from_secs(4);
            while Instant::now() < deadline {
                if let Ok(Some(_)) = child.try_wait() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            let _ = child.kill();
            if let Ok(out) = child.wait_with_output() {
                let text = String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
                version = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(90).collect();
            }
        }
    }
    Some(ToolInfo { path: path.to_string_lossy().into_owned(), version })
}

#[cfg(windows)]
fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"', '&', '|', '<', '>', '^', '(', ')']) {
        arg.to_string()
    } else {
        format!("\"{}\"", arg.replace('"', "\"\""))
    }
}

/// Runs `argv` in its own console window that stays open until a key is pressed.
#[cfg(windows)]
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

#[cfg(unix)]
fn sh_quote(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', r"'\''"))
}

/// Runs `argv` in a terminal emulator window that stays open until a key is pressed.
#[cfg(unix)]
#[tauri::command]
pub fn run_in_console(argv: Vec<String>, cwd: String, title: String) -> Result<(), String> {
    let _ = title;
    let line = argv.iter().map(|a| sh_quote(a)).collect::<Vec<_>>().join(" ");
    let script = format!("{line}; echo; read -n1 -rsp 'Press any key to close…'");
    let mut candidates: Vec<String> = std::env::var("TERMINAL").ok().into_iter().collect();
    candidates.extend(
        ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "kitty", "alacritty", "wezterm", "foot", "xterm"]
            .map(String::from),
    );
    for term in candidates {
        let Some(path) = which(&term) else { continue };
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let mut cmd = Command::new(&path);
        match name.as_str() {
            "gnome-terminal" => cmd.arg("--"),
            "kitty" | "foot" => &mut cmd,
            "wezterm" => cmd.arg("start").arg("--"),
            "xfce4-terminal" => cmd.arg("-x"),
            _ => cmd.arg("-e"),
        };
        if cmd.args(["bash", "-c", &script]).current_dir(&cwd).spawn().is_ok() {
            return Ok(());
        }
    }
    Err("NOTFOUND:No terminal emulator was found. Set the TERMINAL environment variable, or turn off \"Run in a separate window\".".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_c_compilers() {
        assert!(is_c_compiler("gcc"));
        assert!(is_c_compiler(r"C:\msys64\ucrt64\bin\g++.exe"));
        assert!(is_c_compiler("/usr/bin/clang"));
        assert!(is_c_compiler("x86_64-w64-mingw32-gcc"));
        assert!(!is_c_compiler("rustc"));
        assert!(!is_c_compiler("python"));
    }

    #[cfg(windows)]
    #[test]
    fn quotes_for_cmd() {
        assert_eq!(quote("a.exe"), "a.exe");
        assert_eq!(quote(r"C:\My Code\a.exe"), r#""C:\My Code\a.exe""#);
        assert_eq!(quote("a&b"), r#""a&b""#);
    }

    #[cfg(unix)]
    #[test]
    fn finds_programs_on_linux() {
        assert!(which("sh").is_some());
        assert!(which("surely-not-a-real-program").is_none());
        assert!(tool_info("sh".into()).is_some());
    }

    #[cfg(unix)]
    #[test]
    fn quotes_for_shell() {
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
    }

    #[cfg(unix)]
    #[test]
    fn stops_whole_process_group() {
        // A shell that starts a child: stopping must end both.
        let mut child = quiet("sh").args(["-c", "sleep 30 & wait"]).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        kill_tree(child.id());
        let status = child.wait().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(exit_code(status), None);
    }

    #[cfg(windows)]
    #[test]
    fn finds_programs() {
        assert!(which("cmd").unwrap().to_string_lossy().to_lowercase().ends_with("cmd.exe"));
        assert!(which("surely-not-a-real-program").is_none());
        assert!(tool_info("cmd".into()).is_some());
    }
}
