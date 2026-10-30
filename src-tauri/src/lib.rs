mod files;
mod large;
mod run;
mod storage;

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Files passed on the command line (or by a second launch) waiting for the UI to open them.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

fn file_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.is_empty() && !a.starts_with("--"))
        .filter_map(|a| {
            let p = PathBuf::from(a);
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            std::path::absolute(&p).ok()
        })
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn take_pending_files(pending: tauri::State<'_, PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

/// Shows the window once the UI has painted (or after a fallback timeout).
fn show_main(app: &AppHandle) {
    let Some(store) = app.try_state::<storage::Store>() else { return };
    if store.shown.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        if store.ui_state().maximized {
            let _ = w.maximize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn app_ready(app: AppHandle) {
    show_main(&app);
}

fn on_screen(app: &AppHandle, ui: &storage::UiState) -> bool {
    let Ok(monitors) = app.available_monitors() else { return false };
    monitors.iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        let (x, y) = (ui.x + 80, ui.y + 20);
        x >= p.x && y >= p.y && x < p.x + s.width as i32 && y < p.y + s.height as i32
    })
}

fn create_main_window(app: &AppHandle, store: &storage::Store) -> tauri::Result<()> {
    let ui = store.ui_state();
    let (r, g, b) = storage::parse_hex(&ui.bg).unwrap_or((27, 27, 31));
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Margin")
        .inner_size(980.0, 700.0)
        .min_inner_size(380.0, 240.0)
        .center()
        // Windows gets Margin's own title bar; Linux desktops keep their native one.
        .decorations(!cfg!(windows))
        // Windows stays hidden until the UI has painted (no white flash). Some Linux
        // compositors never present a window that starts hidden, so it shows right away there.
        .visible(!cfg!(windows))
        .background_color(tauri::window::Color(r, g, b, 255))
        .initialization_script(store.boot_script())
        .build()?;
    if ui.has_geometry && ui.width >= 200 && ui.height >= 150 && on_screen(app, &ui) {
        let _ = window.set_size(PhysicalSize::new(ui.width, ui.height));
        let _ = window.set_position(PhysicalPosition::new(ui.x, ui.y));
    }
    // Never leave the user with an invisible app, even if the UI fails to start.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(2500));
        show_main(&handle);
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WSL's Wayland bridge doesn't present WebKitGTK windows reliably; its X11 bridge does.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WSL_DISTRO_NAME").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = file_args(&argv, Path::new(&cwd));
            if let Some(pending) = app.try_state::<PendingFiles>() {
                pending.0.lock().unwrap().extend(files);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.emit("open-files", ());
                if w.is_minimized().unwrap_or(false) {
                    let _ = w.unminimize();
                }
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles::default())
        .manage(large::LargeFiles::default())
        .manage(run::Runs::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect();
            app.state::<PendingFiles>().0.lock().unwrap().extend(file_args(&args, &cwd));
            let store = storage::Store::init(app.handle())?;
            create_main_window(app.handle(), &store)?;
            app.manage(store);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                if let Some(store) = window.try_state::<storage::Store>() {
                    store.track_window(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            app_ready,
            files::read_text_file,
            files::write_text_file,
            files::stat_files,
            files::list_dir,
            files::is_dir,
            storage::save_settings,
            storage::save_session,
            storage::write_backup,
            storage::read_backup,
            storage::prune_backups,
            storage::list_themes,
            storage::save_theme,
            storage::set_window_bg,
            large::large_open,
            large::large_status,
            large::large_lines,
            large::large_search,
            large::large_close,
            run::run_start,
            run::run_input,
            run::run_kill,
            run::run_in_console,
            run::tool_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Margin");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(store) = app.try_state::<storage::Store>() {
                store.save_ui_state();
            }
            if let Some(runs) = app.try_state::<run::Runs>() {
                run::kill_all(&runs);
            }
        }
    });
}
