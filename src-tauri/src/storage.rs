//! App data: settings, session (open tabs), unsaved-tab backups, custom themes, window state.

use crate::files::write_atomic;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct UiState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub has_geometry: bool,
    pub maximized: bool,
    pub bg: String,
}

impl Default for UiState {
    fn default() -> Self {
        UiState { x: 0, y: 0, width: 0, height: 0, has_geometry: false, maximized: false, bg: "#1b1b1f".into() }
    }
}

pub struct Store {
    config_dir: PathBuf,
    data_dir: PathBuf,
    ui: Mutex<UiState>,
    pub shown: AtomicBool,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl Store {
    pub fn init(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let config_dir = app.path().app_config_dir()?;
        let data_dir = app.path().app_local_data_dir()?;
        fs::create_dir_all(config_dir.join("themes"))?;
        fs::create_dir_all(data_dir.join("backups"))?;
        let ui = fs::read_to_string(data_dir.join("state.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<UiState>(&s).ok())
            .unwrap_or_default();
        Ok(Store { config_dir, data_dir, ui: Mutex::new(ui), shown: AtomicBool::new(false) })
    }

    fn settings_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    fn themes_dir(&self) -> PathBuf {
        self.config_dir.join("themes")
    }

    fn backup_path(&self, id: &str) -> PathBuf {
        self.data_dir.join("backups").join(format!("{}.txt", id))
    }

    pub fn ui_state(&self) -> UiState {
        self.ui.lock().unwrap().clone()
    }

    /// Everything the UI needs at startup, injected before any page script runs
    /// so the first paint doesn't wait for a round trip.
    pub fn boot_script(&self) -> String {
        let settings = fs::read_to_string(self.settings_path()).ok();
        let session = fs::read_to_string(self.data_dir.join("session.json")).ok();
        let boot = json!({
            "settingsText": settings,
            "sessionText": session,
            "customThemes": read_themes(&self.themes_dir()),
            "paths": {
                "settings": self.settings_path(),
                "themes": self.themes_dir(),
                "config": self.config_dir,
            },
            "version": env!("CARGO_PKG_VERSION"),
        });
        format!("window.__MARGIN_BOOT__ = {};", boot)
    }

    pub fn track_window(&self, w: &tauri::Window) {
        if !self.shown.load(Ordering::Relaxed) || w.is_minimized().unwrap_or(true) {
            return;
        }
        let maximized = w.is_maximized().unwrap_or(false);
        let mut ui = self.ui.lock().unwrap();
        ui.maximized = maximized;
        if maximized {
            return;
        }
        if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
            if size.width > 0 && size.height > 0 {
                ui.x = pos.x;
                ui.y = pos.y;
                ui.width = size.width;
                ui.height = size.height;
                ui.has_geometry = true;
            }
        }
    }

    pub fn save_ui_state(&self) {
        let ui = self.ui.lock().unwrap().clone();
        if let Ok(text) = serde_json::to_string_pretty(&ui) {
            let _ = write_atomic(&self.data_dir.join("state.json"), text.as_bytes());
        }
    }
}

pub fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(((v >> 16) as u8, (v >> 8) as u8, v as u8))
}

#[tauri::command(async)]
pub fn save_settings(store: State<'_, Store>, text: String) -> Result<(), String> {
    write_atomic(&store.settings_path(), text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn save_session(store: State<'_, Store>, text: String) -> Result<(), String> {
    write_atomic(&store.data_dir.join("session.json"), text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn write_backup(store: State<'_, Store>, id: String, content: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid backup id".into());
    }
    write_atomic(&store.backup_path(&id), content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn read_backup(store: State<'_, Store>, id: String) -> Result<Option<String>, String> {
    if !valid_id(&id) {
        return Ok(None);
    }
    Ok(fs::read_to_string(store.backup_path(&id)).ok())
}

/// Deletes every backup that doesn't belong to a tab in `keep`.
#[tauri::command(async)]
pub fn prune_backups(store: State<'_, Store>, keep: Vec<String>) -> Result<(), String> {
    let dir = store.data_dir.join("backups");
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let path = entry.path();
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if path.extension().is_some_and(|e| e == "txt") && !keep.contains(&stem) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ThemeFile {
    file: String,
    text: String,
}

fn read_themes(dir: &std::path::Path) -> Vec<ThemeFile> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("json")) {
                if let Ok(text) = fs::read_to_string(&path) {
                    out.push(ThemeFile { file: path.to_string_lossy().into_owned(), text });
                }
            }
        }
    }
    out
}

#[tauri::command(async)]
pub fn list_themes(store: State<'_, Store>) -> Vec<ThemeFile> {
    read_themes(&store.themes_dir())
}

#[tauri::command(async)]
pub fn save_theme(store: State<'_, Store>, name: String, text: String) -> Result<String, String> {
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == ' ' { c } else { '-' })
        .collect::<String>()
        .trim()
        .to_string();
    let safe = if safe.is_empty() { "theme".to_string() } else { safe };
    let path = store.themes_dir().join(format!("{}.json", safe));
    write_atomic(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn set_window_bg(store: State<'_, Store>, window: WebviewWindow, hex: String) {
    if let Some((r, g, b)) = parse_hex(&hex) {
        store.ui.lock().unwrap().bg = hex;
        let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
    }
}
